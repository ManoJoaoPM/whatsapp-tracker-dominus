import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Client from '../models/Client.js';
import MetaLeadLog from '../models/MetaLeadLog.js';
import MetaEventLog from '../models/MetaEventLog.js';
import { retryMetaEventLog } from '../services/metaEventQueue.js';
import { encryptForStorage } from '../services/secretVault.js';
import { resolveCurrency, resolveMetaEventsConfig, sendMetaTestEvent } from '../services/metaConversions.js';

const normalizePixelId = (v: any): string => {
  return String(v || '').trim();
};

const presentIntegration = (client: any) => ({
  pixelId: String(client?.metaAds?.pixelId || '').trim() || null,
  pageId: String(client?.metaAds?.pageId || '').trim() || null,
  hasAccessToken: Boolean(client?.metaAds?.capiAccessTokenEnc),
  mqlTriggerLevel: String(client?.metaAds?.mqlTriggerLevel || 'hot'),
  sendUntracked: Boolean(client?.metaAds?.sendUntracked),
  currency: resolveCurrency(client?.metaAds?.currency),
  events: resolveMetaEventsConfig(client?.metaAds?.events),
  updatedAt: client?.metaAds?.updatedAt || null,
});

export const getMetaAdsIntegration = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = await Client.findById(req.currentClient.id).select('+metaAds.capiAccessTokenEnc');
    res.json(presentIntegration(client));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateMetaAdsIntegration = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const pixelId = normalizePixelId(req.body?.pixelId);
    const pageId = String(req.body?.pageId || '').trim();
    const accessTokenRaw = req.body?.accessToken;
    const clearAccessToken = Boolean(req.body?.clearAccessToken);
    const mqlTriggerLevelRaw = String(req.body?.mqlTriggerLevel || '').trim();
    const sendUntracked = typeof req.body?.sendUntracked === 'boolean' ? req.body.sendUntracked : undefined;
    const eventsRaw = req.body?.events;
    const currencyRaw = req.body?.currency;

    if (
      !pixelId &&
      accessTokenRaw == null &&
      !clearAccessToken &&
      !mqlTriggerLevelRaw &&
      !pageId &&
      sendUntracked === undefined &&
      eventsRaw === undefined &&
      currencyRaw === undefined
    ) {
      res.status(400).json({ message: 'At least one field is required' });
      return;
    }

    const update: any = { $set: { 'metaAds.updatedAt': new Date() } };
    if (pixelId) {
      if (!/^\d{5,30}$/.test(pixelId)) {
        res.status(400).json({ message: 'Invalid pixelId' });
        return;
      }
      update.$set['metaAds.pixelId'] = pixelId;
    }

    if (pageId !== undefined && pageId !== null) {
      update.$set['metaAds.pageId'] = pageId;
    }

    if (clearAccessToken) {
      update.$unset = { ...(update.$unset || {}), 'metaAds.capiAccessTokenEnc': 1 };
    } else if (typeof accessTokenRaw === 'string') {
      const token = accessTokenRaw.trim();
      if (!token) {
        res.status(400).json({ message: 'Invalid accessToken' });
        return;
      }
      update.$set['metaAds.capiAccessTokenEnc'] = encryptForStorage(token);
    }

    if (mqlTriggerLevelRaw) {
      const v = mqlTriggerLevelRaw.toLowerCase();
      if (v !== 'cold' && v !== 'warm' && v !== 'hot') {
        res.status(400).json({ message: 'Invalid mqlTriggerLevel' });
        return;
      }
      update.$set['metaAds.mqlTriggerLevel'] = v;
    }

    if (sendUntracked !== undefined) {
      update.$set['metaAds.sendUntracked'] = sendUntracked;
    }

    if (currencyRaw !== undefined) {
      const code = String(currencyRaw).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        res.status(400).json({ message: 'Invalid currency (use an ISO 4217 code such as BRL)' });
        return;
      }
      update.$set['metaAds.currency'] = code;
    }

    if (eventsRaw !== undefined) {
      if (!eventsRaw || typeof eventsRaw !== 'object') {
        res.status(400).json({ message: 'Invalid events' });
        return;
      }
      const { leadSubmitted, qualifiedLead, purchase } = eventsRaw as any;

      if (leadSubmitted !== undefined) {
        if (typeof leadSubmitted?.enabled === 'boolean') update.$set['metaAds.events.leadSubmitted.enabled'] = leadSubmitted.enabled;
        if (leadSubmitted?.minInbound !== undefined) {
          const n = Number(leadSubmitted.minInbound);
          if (!Number.isInteger(n) || n < 1 || n > 20) {
            res.status(400).json({ message: 'leadSubmitted.minInbound must be an integer between 1 and 20' });
            return;
          }
          update.$set['metaAds.events.leadSubmitted.minInbound'] = n;
        }
      }
      if (typeof qualifiedLead?.enabled === 'boolean') update.$set['metaAds.events.qualifiedLead.enabled'] = qualifiedLead.enabled;
      if (typeof purchase?.enabled === 'boolean') update.$set['metaAds.events.purchase.enabled'] = purchase.enabled;
    }

    const client = await Client.findOneAndUpdate(
      { _id: req.currentClient.id, userId: req.user.id },
      update,
      { new: true },
    ).select('+metaAds.capiAccessTokenEnc');

    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    res.json(presentIntegration(client));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const testMetaAdsEvent = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const testEventCode = String(req.body?.testEventCode || '').trim();
    const eventName = String(req.body?.eventName || '').trim();
    const actionSource = String(req.body?.actionSource || '').trim();
    const eventSourceUrl = String(req.body?.eventSourceUrl || '').trim();
    const ctwaClid = String(req.body?.ctwaClid || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!testEventCode) {
      res.status(400).json({ message: 'testEventCode is required' });
      return;
    }

    const clientUserAgent = String(req.headers['user-agent'] || '').trim() || undefined;
    const clientIpAddress = String((req.headers['x-forwarded-for'] as any) || req.ip || '').split(',')[0]?.trim() || undefined;

    const result = await sendMetaTestEvent({
      clientId: String(req.currentClient.id),
      testEventCode,
      clientIpAddress,
      clientUserAgent,
      eventName: eventName || undefined,
      actionSource: (actionSource as any) || undefined,
      eventSourceUrl: eventSourceUrl || undefined,
      ctwaClid: ctwaClid || undefined,
      phone: phone || undefined,
    });
    if (result.ok) {
      res.json({ ok: true, status: result.status, response: result.response, debug: result.debug });
      return;
    }
    res.status(400).json({ ok: false, status: result.status, message: result.error || 'Test failed', debug: result.debug });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

const EVENT_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;

export const getMetaEventLogs = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

    const filter: any = { clientId: req.currentClient.id };
    if (status) {
      if (!(EVENT_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ message: 'Invalid status' });
        return;
      }
      filter.status = status;
    }

    const [events, countsAgg] = await Promise.all([
      MetaEventLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      MetaEventLog.aggregate([
        { $match: { clientId: req.currentClient._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const counts: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0 };
    for (const row of countsAgg) {
      if (row?._id && typeof row.count === 'number') counts[String(row._id)] = row.count;
    }

    res.json({ counts, events });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const retryMetaEvent = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const result = await retryMetaEventLog(String(req.currentClient.id), String(req.params.id));
    if (result.ok) {
      res.json({ ok: true });
      return;
    }
    const status = result.reason === 'not_found' ? 404 : 400;
    res.status(status).json({ ok: false, reason: result.reason });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getMetaLeadLogs = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const logs = await MetaLeadLog.find({ clientId: req.currentClient.id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
