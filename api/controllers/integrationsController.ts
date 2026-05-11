import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Client from '../models/Client.js';
import MetaLeadLog from '../models/MetaLeadLog.js';
import { encryptForStorage } from '../services/secretVault.js';
import { sendMetaTestEvent } from '../services/metaConversions.js';

const normalizePixelId = (v: any): string => {
  return String(v || '').trim();
};

export const getMetaAdsIntegration = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = await Client.findById(req.currentClient.id).select('+metaAds.capiAccessTokenEnc');
    const pixelId = String(client?.metaAds?.pixelId || '').trim() || null;
    const pageId = String(client?.metaAds?.pageId || '').trim() || null;
    const hasAccessToken = Boolean(client?.metaAds?.capiAccessTokenEnc);
    const mqlTriggerLevel = String(client?.metaAds?.mqlTriggerLevel || 'hot');
    const updatedAt = client?.metaAds?.updatedAt || null;
    res.json({ pixelId, pageId, hasAccessToken, mqlTriggerLevel, updatedAt });
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

    if (!pixelId && accessTokenRaw == null && !clearAccessToken && !mqlTriggerLevelRaw && !pageId) {
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

    const client = await Client.findOneAndUpdate(
      { _id: req.currentClient.id, userId: req.user.id },
      update,
      { new: true },
    ).select('+metaAds.capiAccessTokenEnc');

    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    res.json({
      pixelId: String(client.metaAds?.pixelId || '').trim() || null,
      pageId: String(client.metaAds?.pageId || '').trim() || null,
      hasAccessToken: Boolean(client.metaAds?.capiAccessTokenEnc),
      mqlTriggerLevel: String(client.metaAds?.mqlTriggerLevel || 'hot'),
      updatedAt: client.metaAds?.updatedAt || null,
    });
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
