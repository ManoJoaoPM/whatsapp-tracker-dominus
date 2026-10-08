import axios from 'axios';
import Conversation from '../models/Conversation.js';
import MetaEventLog from '../models/MetaEventLog.js';
import type { IMetaEventLog } from '../models/MetaEventLog.js';
import type { MetaConfig } from './metaConversions.js';
import {
  META_API_VERSION,
  getClientMetaConfig,
  normalizePhone,
  sha256,
} from './metaConversions.js';
import { readEventsReceived, validateMetaEvent, wasEventAccepted } from './metaEventValidation.js';
import {
  STUCK_LOCK_SECONDS,
  classifyDeliveryError,
  hasReachedTriggerLevel,
  isEventTooOld,
  nextRetryDelaySeconds,
} from './metaRetryPolicy.js';

/* ------------------------------------------------------------------ */
/* Delivery decision (pure: no database, HTTP is injected)             */
/* ------------------------------------------------------------------ */

export type PostEvents = (url: string, body: unknown, accessToken: string) => Promise<{ status: number; data: any }>;

export type DeliveryOutcome =
  | { kind: 'sent'; httpStatus: number; eventsReceived: number; responseBody: any }
  | { kind: 'retry'; delaySeconds: number; error: string; httpStatus?: number; metaCode?: number }
  | { kind: 'failed'; error: string; httpStatus?: number; metaCode?: number; responseBody?: any };

const defaultPost: PostEvents = async (url, body, accessToken) => {
  const response = await axios.post(url, body, { params: { access_token: accessToken }, timeout: 15_000 });
  return { status: response.status, data: response.data };
};

/**
 * One delivery attempt. Never throws: the outcome says whether the event was delivered,
 * must be retried later, or needs a human.
 */
export const attemptDelivery = async (params: {
  event: any;
  /** attempts already made INCLUDING this one (>= 1) */
  attemptsMade: number;
  config: { pixelId: string; pageId?: string; accessToken: string } | null;
  post?: PostEvents;
  nowSeconds?: number;
}): Promise<{ outcome: DeliveryOutcome; requestBody?: any }> => {
  const { config, attemptsMade } = params;
  const post = params.post ?? defaultPost;

  if (!config || !config.pixelId || !config.accessToken) {
    return { outcome: { kind: 'failed', error: 'not_configured: pixel ID or CAPI token missing' } };
  }

  // Work on a copy; page_id follows the current integration settings so that fixing the
  // configuration and resending actually changes what is sent.
  const event = JSON.parse(JSON.stringify(params.event ?? {}));
  event.user_data = event.user_data ?? {};
  if (config.pageId) event.user_data.page_id = config.pageId;
  else delete event.user_data.page_id;

  const issues = validateMetaEvent(event, params.nowSeconds);
  if (issues.length > 0) {
    return { outcome: { kind: 'failed', error: `invalid_event: ${issues.join('; ')}`.slice(0, 500) } };
  }

  const body = { data: [event] };
  const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(config.pixelId)}/events`;

  try {
    const response = await post(url, body, config.accessToken);

    if (!wasEventAccepted(response.data)) {
      return {
        requestBody: body,
        outcome: {
          kind: 'failed',
          httpStatus: response.status,
          responseBody: response.data,
          error: `events_received=${readEventsReceived(response.data) ?? 'missing'}: Meta did not accept the event`,
        },
      };
    }

    return {
      requestBody: body,
      outcome: {
        kind: 'sent',
        httpStatus: response.status,
        eventsReceived: readEventsReceived(response.data) ?? 1,
        responseBody: response.data,
      },
    };
  } catch (error: any) {
    const info = classifyDeliveryError(error);

    if (info.retryable) {
      const delaySeconds = nextRetryDelaySeconds(attemptsMade);
      if (delaySeconds !== null) {
        return {
          requestBody: body,
          outcome: { kind: 'retry', delaySeconds, error: info.message, httpStatus: info.httpStatus, metaCode: info.metaCode },
        };
      }
      return {
        requestBody: body,
        outcome: {
          kind: 'failed',
          error: `${info.message} (no retries left)`.slice(0, 500),
          httpStatus: info.httpStatus,
          metaCode: info.metaCode,
          responseBody: error?.response?.data,
        },
      };
    }

    return {
      requestBody: body,
      outcome: {
        kind: 'failed',
        error: info.message,
        httpStatus: info.httpStatus,
        metaCode: info.metaCode,
        responseBody: error?.response?.data,
      },
    };
  }
};

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

const claim = (filter: Record<string, unknown>) =>
  MetaEventLog.findOneAndUpdate(
    { ...filter, status: 'pending' },
    { $set: { status: 'sending', lockedAt: new Date(), lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } },
  );

/** Mirrors the result on the conversation so the existing UI/analytics keep working */
const syncConversation = async (log: IMetaEventLog, update: Record<string, unknown>) => {
  if (log.eventName !== 'QualifiedLead') return;
  await Conversation.updateOne({ _id: log.conversationId, clientId: log.clientId }, update).catch((err) => {
    console.error('[meta-events] could not sync conversation', err?.message || err);
  });
};

const processClaimed = async (log: IMetaEventLog, post?: PostEvents): Promise<DeliveryOutcome> => {
  const config = await getClientMetaConfig(String(log.clientId)).catch(() => null);
  const { outcome, requestBody } = await attemptDelivery({
    event: log.event,
    attemptsMade: log.attempts,
    config,
    post,
  });

  if (outcome.kind === 'sent') {
    await MetaEventLog.updateOne(
      { _id: log._id },
      {
        $set: {
          status: 'sent',
          sentAt: new Date(),
          lastHttpStatus: outcome.httpStatus,
          eventsReceived: outcome.eventsReceived,
          responseBody: outcome.responseBody,
          requestBody,
        },
        $unset: { lockedAt: 1, nextAttemptAt: 1, lastError: 1, lastMetaCode: 1 },
      },
    );
    await syncConversation(log, {
      $set: {
        'metaConversions.mqlQualifiedEventId': log.eventId,
        'metaConversions.mqlQualifiedSentAt': new Date(),
        'metaConversions.mqlQualifiedLastStatus': outcome.httpStatus,
      },
      $unset: { 'metaConversions.mqlQualifiedLastError': 1 },
    });
    console.log(`[meta-events] sent ${log.eventName} ${log.eventId} (attempt ${log.attempts})`);
  } else if (outcome.kind === 'retry') {
    await MetaEventLog.updateOne(
      { _id: log._id },
      {
        $set: {
          status: 'pending',
          nextAttemptAt: new Date(Date.now() + outcome.delaySeconds * 1000),
          lastError: outcome.error,
          lastHttpStatus: outcome.httpStatus,
          lastMetaCode: outcome.metaCode,
          requestBody,
        },
        $unset: { lockedAt: 1 },
      },
    );
    await syncConversation(log, {
      $set: {
        'metaConversions.mqlQualifiedLastError': outcome.error,
        ...(outcome.httpStatus ? { 'metaConversions.mqlQualifiedLastStatus': outcome.httpStatus } : {}),
      },
    });
    console.warn(`[meta-events] retry ${log.eventId} in ${outcome.delaySeconds}s: ${outcome.error}`);
  } else {
    await MetaEventLog.updateOne(
      { _id: log._id },
      {
        $set: {
          status: 'failed',
          lastError: outcome.error,
          lastHttpStatus: outcome.httpStatus,
          lastMetaCode: outcome.metaCode,
          responseBody: outcome.responseBody,
          requestBody,
        },
        $unset: { lockedAt: 1, nextAttemptAt: 1 },
      },
    );
    await syncConversation(log, {
      $set: {
        'metaConversions.mqlQualifiedLastError': outcome.error,
        ...(outcome.httpStatus ? { 'metaConversions.mqlQualifiedLastStatus': outcome.httpStatus } : {}),
      },
    });
    console.error(`[meta-events] failed ${log.eventId}: ${outcome.error}`);
  }

  return outcome;
};

const deliverById = async (id: unknown): Promise<void> => {
  const claimed = await claim({ _id: id });
  if (claimed) await processClaimed(claimed);
};

/* ------------------------------------------------------------------ */
/* Enqueue                                                             */
/* ------------------------------------------------------------------ */

export type MetaFunnelEvent = 'LeadSubmitted' | 'QualifiedLead' | 'Purchase';

type EnqueueResult = { queued: boolean; reason?: string };

type LeadForEvent = {
  origin?: string;
  metaCtwaClid?: string;
  contactPhone: string;
};

/**
 * Common to every event of the ladder: only Meta leads, and (unless the client opted in)
 * only the ones whose ad click we know.
 */
const commonEligibility = (conv: LeadForEvent | null, config: MetaConfig): string | null => {
  if (!conv) return 'conversation_not_found';
  if (conv.origin !== 'meta_ads') return 'not_meta_lead';
  if (!conv.metaCtwaClid && !config.sendUntracked) return 'untracked_conversation';
  return null;
};

const buildEvent = (params: {
  eventName: MetaFunnelEvent;
  conversationId: string;
  clientId: string;
  conv: LeadForEvent;
  config: MetaConfig;
  customData?: Record<string, unknown>;
}) => {
  const { conv, config } = params;

  const ph = normalizePhone(conv.contactPhone);
  const phHash = ph ? sha256(ph) : undefined;
  const externalId = ph
    ? sha256(`${params.clientId}:${ph}`)
    : sha256(`${params.clientId}:${params.conversationId}`);

  const isMessaging = Boolean(conv.metaCtwaClid);
  const dedupeKey = `${params.conversationId}:${params.eventName}`;

  // JSON round trip drops undefined values, which would otherwise be stored as null
  const event = JSON.parse(
    JSON.stringify({
      event_name: params.eventName,
      event_time: Math.floor(Date.now() / 1000),
      action_source: isMessaging ? 'business_messaging' : 'chat',
      ...(isMessaging ? { messaging_channel: 'whatsapp' } : {}),
      event_id: dedupeKey,
      user_data: {
        external_id: [externalId],
        ...(phHash ? { ph: [phHash] } : {}),
        ...(isMessaging ? { ctwa_clid: conv.metaCtwaClid } : {}),
        ...(config.pageId ? { page_id: config.pageId } : {}),
      },
      custom_data: {
        conversation_id: params.conversationId,
        ...(params.customData ?? {}),
      },
    }),
  );

  return { event, dedupeKey };
};

/**
 * Stores the event durably and starts the first delivery attempt. One event per conversation
 * and name, ever: the unique dedupe key makes calling this repeatedly safe.
 */
const insertAndDeliver = async (params: {
  clientId: string;
  conversationId: string;
  eventName: MetaFunnelEvent;
  event: any;
  dedupeKey: string;
}): Promise<EnqueueResult> => {
  let log: IMetaEventLog;
  try {
    log = await MetaEventLog.create({
      clientId: params.clientId,
      conversationId: params.conversationId,
      eventName: params.eventName,
      eventId: params.dedupeKey,
      dedupeKey: params.dedupeKey,
      status: 'pending',
      nextAttemptAt: new Date(),
      event: params.event,
    });
  } catch (error: any) {
    if (error?.code === 11000) return { queued: false, reason: 'already_queued' };
    throw error;
  }

  void deliverById(log._id).catch((err) => {
    console.error('[meta-events] immediate delivery error', err?.message || err);
  });

  return { queued: true };
};

/**
 * QualifiedLead: called after a conversation is scored. Only evaluations that passed every
 * gate (verified evidence, no manipulation, second opinion) may produce this signal.
 */
export const enqueueMetaMqlQualifiedConversion = async (params: {
  conversationId: string;
  clientId: string;
}): Promise<EnqueueResult> => {
  const config = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!config) return { queued: false, reason: 'not_configured' };
  if (!config.events.qualifiedLead.enabled) return { queued: false, reason: 'event_disabled' };

  const conv = await Conversation.findOne({ _id: params.conversationId, clientId: params.clientId })
    .select('origin metaCtwaClid contactPhone mqlScore mqlLevel mqlConfirmed mqlManipulation funnelStage metaConversions.mqlQualifiedSentAt')
    .lean();

  const blocked = commonEligibility(conv, config);
  if (blocked || !conv) return { queued: false, reason: blocked ?? 'conversation_not_found' };

  if (!hasReachedTriggerLevel(conv.mqlLevel, config.triggerLevel)) return { queued: false, reason: 'not_triggered' };

  // A sale closed by a person overrides a manipulation flag.
  const closedByPerson = conv.funnelStage === 'closed';
  if (!conv.mqlConfirmed || (conv.mqlManipulation && !closedByPerson)) return { queued: false, reason: 'not_confirmed' };

  // Events sent before the outbox existed
  if (conv.metaConversions?.mqlQualifiedSentAt) return { queued: false, reason: 'already_sent' };

  const { event, dedupeKey } = buildEvent({
    eventName: 'QualifiedLead',
    conversationId: params.conversationId,
    clientId: params.clientId,
    conv,
    config,
    customData: {
      mql_level: String(conv.mqlLevel || ''),
      mql_score: typeof conv.mqlScore === 'number' ? conv.mqlScore : undefined,
    },
  });

  return insertAndDeliver({ ...params, eventName: 'QualifiedLead', event, dedupeKey });
};

/**
 * LeadSubmitted: the early signal, so the algorithm gets volume. It does not depend on the AI:
 * the lead only needs to have answered `minInbound` times.
 */
export const enqueueMetaLeadSubmitted = async (params: {
  conversationId: string;
  clientId: string;
}): Promise<EnqueueResult> => {
  const config = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!config) return { queued: false, reason: 'not_configured' };
  if (!config.events.leadSubmitted.enabled) return { queued: false, reason: 'event_disabled' };

  const conv = await Conversation.findOne({ _id: params.conversationId, clientId: params.clientId })
    .select('origin metaCtwaClid contactPhone inboundMessageCount')
    .lean();

  const blocked = commonEligibility(conv, config);
  if (blocked || !conv) return { queued: false, reason: blocked ?? 'conversation_not_found' };

  if (Number(conv.inboundMessageCount || 0) < config.events.leadSubmitted.minInbound) {
    return { queued: false, reason: 'waiting_for_replies' };
  }

  const { event, dedupeKey } = buildEvent({
    eventName: 'LeadSubmitted',
    conversationId: params.conversationId,
    clientId: params.clientId,
    conv,
    config,
  });

  const result = await insertAndDeliver({ ...params, eventName: 'LeadSubmitted', event, dedupeKey });
  if (result.queued || result.reason === 'already_queued') {
    // lets the webhook skip this check for the rest of the conversation
    await Conversation.updateOne(
      { _id: params.conversationId },
      { $set: { 'metaConversions.leadSubmittedQueuedAt': new Date() } },
    ).catch(() => undefined);
  }
  return result;
};

/**
 * Purchase: only after a PERSON closed the sale and informed its value. The value is what lets
 * Meta optimise for return on ad spend.
 */
export const enqueueMetaPurchase = async (params: {
  conversationId: string;
  clientId: string;
}): Promise<EnqueueResult> => {
  const config = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!config) return { queued: false, reason: 'not_configured' };
  if (!config.events.purchase.enabled) return { queued: false, reason: 'event_disabled' };

  const conv = await Conversation.findOne({ _id: params.conversationId, clientId: params.clientId })
    .select('origin metaCtwaClid contactPhone funnelStage saleValue')
    .lean();

  const blocked = commonEligibility(conv, config);
  if (blocked || !conv) return { queued: false, reason: blocked ?? 'conversation_not_found' };

  if (conv.funnelStage !== 'closed') return { queued: false, reason: 'not_closed' };

  const value = Number(conv.saleValue);
  if (!Number.isFinite(value) || value <= 0) return { queued: false, reason: 'missing_value' };

  const { event, dedupeKey } = buildEvent({
    eventName: 'Purchase',
    conversationId: params.conversationId,
    clientId: params.clientId,
    conv,
    config,
    customData: { currency: config.currency, value },
  });

  return insertAndDeliver({ ...params, eventName: 'Purchase', event, dedupeKey });
};

/* ------------------------------------------------------------------ */
/* Manual resend                                                       */
/* ------------------------------------------------------------------ */

export const retryMetaEventLog = async (
  clientId: string,
  id: string,
): Promise<{ ok: boolean; reason?: string }> => {
  const log = await MetaEventLog.findOne({ _id: id, clientId }).select('status event');
  if (!log) return { ok: false, reason: 'not_found' };
  if (log.status !== 'failed') return { ok: false, reason: 'not_failed' };
  if (typeof log.event?.event_time === 'number' && isEventTooOld(log.event.event_time)) {
    return { ok: false, reason: 'event_too_old' };
  }

  const updated = await MetaEventLog.findOneAndUpdate(
    { _id: id, clientId, status: 'failed' },
    {
      $set: { status: 'pending', nextAttemptAt: new Date(), attempts: 0 },
      $inc: { manualRetries: 1 },
      $unset: { lastError: 1, lastMetaCode: 1 },
    },
    { new: true },
  );
  if (!updated) return { ok: false, reason: 'not_failed' };

  void deliverById(updated._id).catch((err) => {
    console.error('[meta-events] manual resend error', err?.message || err);
  });
  return { ok: true };
};

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

/** Events whose worker died mid-attempt go back to the queue */
export const recoverStuckMetaEvents = async (): Promise<number> => {
  const result = await MetaEventLog.updateMany(
    { status: 'sending', lockedAt: { $lt: new Date(Date.now() - STUCK_LOCK_SECONDS * 1000) } },
    { $set: { status: 'pending', nextAttemptAt: new Date() }, $unset: { lockedAt: 1 } },
  );
  return result.modifiedCount ?? 0;
};

export const runMetaEventWorkerOnce = async (limit = 25): Promise<number> => {
  const recovered = await recoverStuckMetaEvents();
  if (recovered > 0) console.warn(`[meta-events] recovered ${recovered} stuck event(s)`);

  let processed = 0;
  while (processed < limit) {
    const claimed = await claim({ nextAttemptAt: { $lte: new Date() } });
    if (!claimed) break;
    await processClaimed(claimed);
    processed += 1;
  }
  return processed;
};

let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

/**
 * Needs a long-running process (Docker / `npm run server:dev`). Serverless hosts such as
 * Vercel never run it, so retries would not happen there.
 */
export const startMetaEventWorker = (intervalMs = 30_000): void => {
  if (workerTimer) return;

  const tick = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      await runMetaEventWorkerOnce();
    } catch (error: any) {
      console.error('[meta-events] worker error', error?.message || error);
    } finally {
      workerRunning = false;
    }
  };

  workerTimer = setInterval(() => void tick(), intervalMs);
  workerTimer.unref?.();
  void tick();
  console.log(`[meta-events] worker started (every ${Math.round(intervalMs / 1000)}s)`);
};
