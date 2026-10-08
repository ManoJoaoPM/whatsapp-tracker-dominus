import type { IConversation } from '../models/Conversation.js';
import { fetchMetaAdDetails } from './metaConversions.js';

const MAX_CLICK_HISTORY = 20;

type AdData = NonNullable<IConversation['metaAdData']>;

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

type FetchAdDetails = (params: { clientId: string; sourceId: string }) => Promise<Partial<AdData> | null>;

/**
 * Builds the ad snapshot saved on the conversation: what the webhook carried
 * (title, body, thumbnail) completed with campaign/adset names from the Graph API.
 */
export const buildMetaAdData = async (
  params: {
    clientId: string;
    sourceId: string | null;
    externalAdReply: Record<string, unknown> | null;
  },
  fetchDetails: FetchAdDetails = fetchMetaAdDetails,
): Promise<AdData | undefined> => {
  const data: AdData = {};
  const { sourceId, externalAdReply } = params;

  if (sourceId) data.sourceId = sourceId;

  if (externalAdReply) {
    const adTitle = asString(externalAdReply.title);
    const adBody = asString(externalAdReply.body);
    const mediaType = asString(externalAdReply.mediaType);
    const thumbnailUrl = asString(externalAdReply.thumbnailUrl);
    const adId = asString(externalAdReply.adId);
    if (adTitle) data.adTitle = adTitle;
    if (adBody) data.adBody = adBody;
    if (mediaType) data.mediaType = mediaType;
    if (thumbnailUrl) data.thumbnailUrl = thumbnailUrl;
    if (adId) data.adId = adId;
  }

  if (sourceId) {
    const details = await fetchDetails({ clientId: params.clientId, sourceId });
    if (details) {
      // Graph API values win, but never overwrite a value we already have with an empty one
      for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null && value !== '') {
          (data as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  return Object.keys(data).length > 0 ? data : undefined;
};

/**
 * Registers an ad click found on an inbound message of an EXISTING conversation.
 *
 * Meta attributes a conversion to the most recent click, so a contact that clicks a new ad
 * must switch to the new ctwa_clid and ad data. Every click is kept in `metaClicks`.
 * Backlog messages (older than the current click) are stored in the history but do not
 * replace the current attribution.
 *
 * Mutates the conversation document; the caller is responsible for saving it.
 * Returns true when a click that was not known yet was registered.
 */
export const registerMetaClick = async (
  params: {
    conversation: IConversation;
    clientId: string;
    ctwaClid: string | null;
    sourceId: string | null;
    externalAdReply: Record<string, unknown> | null;
    externalMessageId?: string;
    at: Date;
  },
  fetchDetails: FetchAdDetails = fetchMetaAdDetails,
): Promise<boolean> => {
  const { conversation, ctwaClid, sourceId, at } = params;
  if (!ctwaClid && !sourceId) return false;

  if (!conversation.metaClicks) conversation.metaClicks = [];

  // A click is identified by its ctwa_clid; without one, by the ad it came from
  const alreadyKnown = ctwaClid
    ? conversation.metaCtwaClid === ctwaClid || conversation.metaClicks.some((c) => c.ctwaClid === ctwaClid)
    : sourceId === conversation.metaAdData?.sourceId;
  if (alreadyKnown) return false;

  conversation.metaClicks.push({
    ctwaClid: ctwaClid || undefined,
    sourceId: sourceId || undefined,
    receivedAt: at,
    externalMessageId: params.externalMessageId,
  });
  if (conversation.metaClicks.length > MAX_CLICK_HISTORY) {
    conversation.metaClicks = conversation.metaClicks.slice(-MAX_CLICK_HISTORY);
  }

  const isNewest = !conversation.metaLastClickAt || at >= conversation.metaLastClickAt;
  if (!isNewest) return true;

  if (ctwaClid) conversation.metaCtwaClid = ctwaClid;
  conversation.metaLastClickAt = at;

  // Replace (not merge) so campaign/adset names of the previous ad do not leak into the new click
  conversation.metaAdData = await buildMetaAdData(
    { clientId: params.clientId, sourceId, externalAdReply: params.externalAdReply },
    fetchDetails,
  );

  if (conversation.originConfidence !== 'manual') {
    conversation.origin = 'meta_ads';
  }

  return true;
};
