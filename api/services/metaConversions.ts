import axios from 'axios';
import crypto from 'crypto';
import Conversation from '../models/Conversation.js';
import type { IConversation } from '../models/Conversation.js';
import Client from '../models/Client.js';
import { decryptFromStorage } from './secretVault.js';

const META_API_VERSION = 'v20.0';

const getClientMetaConfig = async (clientId: string): Promise<{ pixelId: string; pageId?: string; accessToken: string; triggerLevel: 'cold' | 'warm' | 'hot' } | null> => {
  const client = await Client.findById(clientId).select('+metaAds.capiAccessTokenEnc');
  const pixelId = String(client?.metaAds?.pixelId || '').trim();
  const pageId = String(client?.metaAds?.pageId || '').trim();
  const enc = String(client?.metaAds?.capiAccessTokenEnc || '').trim();
  const triggerLevel = (client?.metaAds?.mqlTriggerLevel || 'hot') as 'cold' | 'warm' | 'hot';
  if (enc) {
    const accessToken = decryptFromStorage(enc);
    return { pixelId, pageId: pageId || undefined, accessToken, triggerLevel };
  }
  return null;
};

export const fetchMetaAdDetails = async (params: {
  clientId: string;
  sourceId: string;
}): Promise<{
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  adTitle?: string;
  adBody?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
} | null> => {
  const metaConfig = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!metaConfig || !metaConfig.accessToken) return null;

  try {
    // Busca dados do anúncio (Ad)
    const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(params.sourceId)}`;
    const response = await axios.get(url, {
      params: {
        access_token: metaConfig.accessToken,
        fields: 'id,name,adset_id,campaign_id,creative{title,body,thumbnail_url,image_url,video_id,object_type}',
      },
      timeout: 10_000,
    });

    const data = response.data;
    if (!data || !data.id) return null;

    let campaignName = '';
    let adsetName = '';

    // Tentar buscar o nome da campanha
    if (data.campaign_id) {
      try {
        const campRes = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(data.campaign_id)}`, {
          params: { access_token: metaConfig.accessToken, fields: 'name' },
          timeout: 5000,
        });
        campaignName = campRes.data?.name || '';
      } catch (e) {
        // ignora se falhar
      }
    }

    // Tentar buscar o nome do conjunto de anúncio
    if (data.adset_id) {
      try {
        const adsetRes = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(data.adset_id)}`, {
          params: { access_token: metaConfig.accessToken, fields: 'name' },
          timeout: 5000,
        });
        adsetName = adsetRes.data?.name || '';
      } catch (e) {
        // ignora se falhar
      }
    }

    const creative = data.creative || {};
    
    return {
      campaignId: data.campaign_id,
      campaignName,
      adsetId: data.adset_id,
      adsetName,
      adId: data.id,
      adName: data.name,
      adTitle: creative.title,
      adBody: creative.body,
      mediaType: creative.object_type,
      thumbnailUrl: creative.thumbnail_url || creative.image_url,
      mediaUrl: creative.image_url,
    };
  } catch (error) {
    console.error('Error fetching Meta Ad details:', error);
    return null;
  }
};

const sha256 = (value: string): string => {
  return crypto.createHash('sha256').update(value).digest('hex');
};

const normalizePhone = (phone: string): string => {
  return String(phone || '').replace(/\D+/g, '');
};

const buildEventId = (conversationId: string): string => {
  return `mql_${String(conversationId)}`;
};

const buildTestEventId = (): string => {
  return `test_${crypto.randomBytes(8).toString('hex')}`;
};

export const shouldTriggerMetaMqlConversion = (params: {
  previousLevel?: IConversation['mqlLevel'];
  nextLevel?: IConversation['mqlLevel'];
  triggerLevel: 'cold' | 'warm' | 'hot';
}): boolean => {
  const trigger = params.triggerLevel;
  if (!params.nextLevel) return false;
  if (params.nextLevel !== trigger) return false;
  return params.previousLevel !== trigger;
};

export const trySendMetaMqlQualifiedConversion = async (params: {
  conversationId: string;
  clientId: string;
  previousLevel?: IConversation['mqlLevel'];
  nextLevel?: IConversation['mqlLevel'];
}): Promise<{ sent: boolean; skipped: boolean; reason?: string } > => {
  const metaConfig = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!metaConfig) return { sent: false, skipped: true, reason: 'not_configured' };

  if (!shouldTriggerMetaMqlConversion({ previousLevel: params.previousLevel, nextLevel: params.nextLevel, triggerLevel: metaConfig.triggerLevel })) {
    return { sent: false, skipped: true, reason: 'not_triggered' };
  }

  const triggerLevel = metaConfig.triggerLevel;
  const eventId = buildEventId(params.conversationId);

  const claimed = await Conversation.findOneAndUpdate(
    {
      _id: params.conversationId,
      clientId: params.clientId,
      origin: 'meta_ads',
      mqlLevel: triggerLevel,
      'metaConversions.mqlQualifiedSentAt': { $exists: false },
      $or: [
        { 'metaConversions.mqlQualifiedSending': { $exists: false } },
        { 'metaConversions.mqlQualifiedSending': { $ne: true } },
      ],
    },
    {
      $set: {
        'metaConversions.mqlQualifiedSending': true,
        'metaConversions.mqlQualifiedAttemptedAt': new Date(),
        'metaConversions.mqlQualifiedEventId': eventId,
      },
      $unset: {
        'metaConversions.mqlQualifiedLastError': 1,
        'metaConversions.mqlQualifiedLastStatus': 1,
      },
    },
    { new: true },
  );

  if (!claimed) return { sent: false, skipped: true, reason: 'not_eligible_or_already_sent' };

  const pixelId = metaConfig.pixelId;
  const pageId = metaConfig.pageId;
  const accessToken = metaConfig.accessToken;
  const apiVersion = META_API_VERSION;

  const ph = normalizePhone(claimed.contactPhone);
  const phHash = ph ? sha256(ph) : undefined;
  const externalId = ph ? sha256(`${params.clientId}:${ph}`) : sha256(`${params.clientId}:${String(params.conversationId)}`);

  const eventTime = Math.floor(Date.now() / 1000);
  const actionSource = claimed.metaCtwaClid ? 'business_messaging' : 'chat';
  
  const body: any = {
    data: [
      {
        event_name: actionSource === 'business_messaging' ? 'qualified_lead' : 'QualifiedLead',
        event_time: eventTime,
        action_source: actionSource,
        ...(actionSource === 'business_messaging' ? { messaging_channel: 'whatsapp' } : {}),
        event_id: eventId,
        user_data: {
          external_id: [externalId],
          ...(phHash ? { ph: [phHash] } : {}),
          ...(actionSource === 'business_messaging' && claimed.metaCtwaClid ? { ctwa_clid: claimed.metaCtwaClid } : {}),
          ...(pageId ? { page_id: pageId } : {}),
        },
        custom_data: {
          conversation_id: String(params.conversationId),
          mql_level: String(claimed.mqlLevel || ''),
          mql_score: typeof claimed.mqlScore === 'number' ? claimed.mqlScore : undefined,
          ...(actionSource !== 'business_messaging' && claimed.metaCtwaClid ? { ctwa_clid: claimed.metaCtwaClid } : {}),
        },
      },
    ],
  };
  try {
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events`;
    const response = await axios.post(url, body, {
      params: { access_token: accessToken },
      timeout: 15_000,
    });

    await Conversation.updateOne(
      { _id: claimed._id },
      {
        $set: {
          'metaConversions.mqlQualifiedSending': false,
          'metaConversions.mqlQualifiedSentAt': new Date(),
          'metaConversions.mqlQualifiedLastStatus': Number(response.status),
        },
      },
    );

    return { sent: true, skipped: false };
  } catch (error: any) {
    const status = Number(error?.response?.status);
    const message = String(error?.response?.data?.error?.message || error?.message || 'Meta CAPI error');

    await Conversation.updateOne(
      { _id: claimed._id },
      {
        $set: {
          'metaConversions.mqlQualifiedSending': false,
          'metaConversions.mqlQualifiedLastError': message.slice(0, 500),
          'metaConversions.mqlQualifiedLastStatus': Number.isFinite(status) ? status : undefined,
        },
      },
    );

    return { sent: false, skipped: false, reason: 'send_failed' };
  }
};

export const sendMetaTestEvent = async (params: {
  clientId: string;
  testEventCode: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  eventName?: string;
  actionSource?: 'website' | 'chat' | 'physical_store' | 'system_generated' | 'business_messaging' | 'other';
  eventSourceUrl?: string;
  ctwaClid?: string;
  phone?: string;
}): Promise<{ ok: boolean; status?: number; response?: any; error?: string; debug?: any } > => {
  const metaConfig = await getClientMetaConfig(params.clientId).catch(() => null);
  if (!metaConfig) return { ok: false, error: 'not_configured' };

  const pixelId = metaConfig.pixelId;
  const pageId = metaConfig.pageId;
  const accessToken = metaConfig.accessToken;
  const apiVersion = META_API_VERSION;
  const eventId = buildTestEventId();

  const eventName = String(params.eventName || 'QualifiedLead').trim() || 'QualifiedLead';
  const actionSource = (params.actionSource || 'website') as any;
  const eventSourceUrl = String(params.eventSourceUrl || '').trim() || undefined;

  const eventTime = Math.floor(Date.now() / 1000);
  const externalId = sha256(`${params.clientId}:${eventId}`);
  
  const ph = params.phone ? normalizePhone(params.phone) : undefined;
  const phHash = ph ? sha256(ph) : undefined;
  
  // Limpeza de espaços em branco invisíveis no ctwa_clid (que poderiam torná-lo inválido)
  const ctwaClid = params.ctwaClid ? String(params.ctwaClid).trim() : undefined;

  const body: any = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        action_source: actionSource,
        ...(actionSource === 'business_messaging' ? { messaging_channel: 'whatsapp' } : {}),
        event_id: eventId,
        ...(actionSource === 'website' && eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: {
          external_id: [externalId],
          ...(actionSource !== 'business_messaging' && params.clientIpAddress ? { client_ip_address: params.clientIpAddress } : {}),
          ...(actionSource !== 'business_messaging' && params.clientUserAgent ? { client_user_agent: params.clientUserAgent } : {}),
          ...(phHash ? { ph: [phHash] } : {}),
          ...(actionSource === 'business_messaging' && ctwaClid ? { ctwa_clid: ctwaClid } : {}),
          ...(pageId ? { page_id: pageId } : {}),
        },
        custom_data: {
          test: true,
          ...(actionSource !== 'business_messaging' && ctwaClid ? { ctwa_clid: ctwaClid } : {}),
          ...(eventName === 'Purchase' || eventName === 'purchase'
            ? {
                currency: 'BRL',
                value: 1,
                contents: [{ id: 'test', quantity: 1 }],
              }
            : {}),
        },
      },
    ],
    test_event_code: String(params.testEventCode || '').trim(),
  };

  if (!body.test_event_code) return { ok: false, error: 'test_event_code_required' };

  try {
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events`;
    const response = await axios.post(url, body, {
      params: { access_token: accessToken },
      timeout: 15_000,
    });
    return {
      ok: true,
      status: Number(response.status),
      response: response.data,
      debug: {
        pixelId,
        url,
        requestBody: body,
      },
    };
  } catch (error: any) {
    const status = Number(error?.response?.status);
    const message = String(error?.response?.data?.error?.message || error?.message || 'Meta CAPI error');
    return {
      ok: false,
      status: Number.isFinite(status) ? status : undefined,
      error: message,
      debug: {
        pixelId,
        requestBody: body,
        responseBody: error?.response?.data,
      },
    };
  }
};
