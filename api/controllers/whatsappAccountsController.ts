import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import MqlEvaluation from '../models/MqlEvaluation.js';
import MetaLeadLog from '../models/MetaLeadLog.js';
import ConnectionInvite from '../models/ConnectionInvite.js';
import { getMediaMessageModel } from '../config/mediaDb.js';
import { connectInstance, deleteInstance, getConnectionState, logoutInstance } from '../services/evolutionService.js';
import {
  extractQrCode,
  mapEvolutionStateToStatus,
  provisionEvolutionAccount,
} from '../services/whatsappProvisioning.js';

export const listWhatsAppAccounts = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const accounts = await WhatsAppAccount.find({ clientId: req.currentClient.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(accounts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createWhatsAppAccount = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = req.currentClient;
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';

    if (provider === 'cloud') {
      const cloudPhoneNumberId =
        typeof req.body?.cloudPhoneNumberId === 'string' ? req.body.cloudPhoneNumberId.trim() : '';
      const cloudWabaId = typeof req.body?.cloudWabaId === 'string' ? req.body.cloudWabaId.trim() : '';
      const cloudDisplayPhoneNumber =
        typeof req.body?.cloudDisplayPhoneNumber === 'string' ? req.body.cloudDisplayPhoneNumber.trim() : '';

      if (!cloudPhoneNumberId) {
        res.status(400).json({ message: 'cloudPhoneNumberId is required' });
        return;
      }

      const account = await WhatsAppAccount.create({
        clientId: client.id,
        provider: 'cloud',
        displayName: displayName || undefined,
        cloudPhoneNumberId,
        cloudWabaId: cloudWabaId || undefined,
        cloudDisplayPhoneNumber: cloudDisplayPhoneNumber || undefined,
        status: 'connected',
        connectedAt: new Date(),
      });

      res.json({
        account,
        qrCode: null,
      });
      return;
    }

    const { account, qrCode } = await provisionEvolutionAccount({
      clientId: String(client.id),
      displayName: displayName || undefined,
    });

    res.json({
      account,
      qrCode,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
};

export const getWhatsAppAccountStatus = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await WhatsAppAccount.findOne({ _id: id, clientId: req.currentClient.id });
    if (!account) {
      res.status(404).json({ message: 'WhatsApp account not found' });
      return;
    }

    if (account.provider === 'cloud') {
      res.json({
        status: account.status,
        qrCode: null,
      });
      return;
    }

    const state = account.instanceId ? await getConnectionState(account.instanceId) : null;
    const status = mapEvolutionStateToStatus(state);
    const qrCode = extractQrCode(state);

    if (status !== account.status) {
      account.status = status;
      if (status === 'connected' && !account.connectedAt) {
        account.connectedAt = new Date();
      }
      await account.save();
    }

    res.json({
      status,
      qrCode,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const refreshWhatsAppAccountQr = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await WhatsAppAccount.findOne({ _id: id, clientId: req.currentClient.id });
    if (!account) {
      res.status(404).json({ message: 'WhatsApp account not found' });
      return;
    }

    if (account.provider === 'cloud') {
      res.status(400).json({ message: 'QR code is not available for cloud accounts' });
      return;
    }

    if (!account.instanceId) {
      res.status(400).json({ message: 'WhatsApp not configured' });
      return;
    }

    const connectRes = await connectInstance(account.instanceId);
    const qrCode = extractQrCode(connectRes);
    if (account.status !== 'pending') {
      account.status = 'pending';
      await account.save();
    }

    res.json({ status: 'pending', qrCode });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const disconnectWhatsAppAccount = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await WhatsAppAccount.findOne({ _id: id, clientId: req.currentClient.id });
    if (!account) {
      res.status(404).json({ message: 'WhatsApp account not found' });
      return;
    }

    if (account.provider === 'cloud') {
      account.status = 'disconnected';
      await account.save();
      res.json({ message: 'Disconnected successfully' });
      return;
    }

    if (!account.instanceId) {
      res.status(400).json({ message: 'WhatsApp not configured' });
      return;
    }

    await logoutInstance(account.instanceId);
    account.status = 'disconnected';
    await account.save();

    res.json({ message: 'Disconnected successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Removes a WhatsApp number from the company.
 *
 * - Evolution numbers are logged out and their instance is deleted. If Evolution does not answer,
 *   nothing is removed unless the caller insists with ?force=true (the number could stay linked
 *   to the phone otherwise).
 * - Conversations and messages are KEPT by default: they feed the dashboard, the kanban and the
 *   history of leads already reported to Meta. ?deleteConversations=true removes them for good.
 * - The record of events sent to Meta (MetaEventLog) is always kept as an audit trail.
 */
export const deleteWhatsAppAccount = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await WhatsAppAccount.findOne({ _id: id, clientId: req.currentClient.id });
    if (!account) {
      res.status(404).json({ message: 'WhatsApp account not found' });
      return;
    }

    const force = req.query.force === 'true';
    const deleteConversations = req.query.deleteConversations === 'true';

    if (account.provider !== 'cloud' && account.instanceId) {
      const result = await deleteInstance(account.instanceId);
      if (result === 'failed' && !force) {
        res.status(502).json({
          message:
            'Não foi possível remover a conexão no servidor do WhatsApp agora. Tente de novo ou exclua mesmo assim (o aparelho pode continuar vinculado).',
          canForce: true,
        });
        return;
      }
    }

    let deletedConversations = 0;
    let deletedMessages = 0;

    if (deleteConversations) {
      const filter = { clientId: account.clientId, whatsappAccountId: account._id };
      const conversationIds = await Conversation.find(filter).distinct('_id');

      if (conversationIds.length > 0) {
        await MqlEvaluation.deleteMany({ conversationId: { $in: conversationIds } });
      }
      await MetaLeadLog.deleteMany(filter);

      const messages = await Message.deleteMany(filter);
      deletedMessages = messages.deletedCount ?? 0;

      // images and audios live in the secondary database
      const MediaMessage = await getMediaMessageModel().catch(() => null);
      if (MediaMessage) await MediaMessage.deleteMany(filter).catch(() => undefined);

      const conversations = await Conversation.deleteMany(filter);
      deletedConversations = conversations.deletedCount ?? 0;
    }

    // customer links that created this number: an unfinished one starts over, a finished one stays as history
    await ConnectionInvite.updateMany(
      { whatsappAccountId: account._id, status: { $in: ['pending', 'started'] } },
      { $set: { status: 'pending' }, $unset: { whatsappAccountId: 1, provisioningAt: 1 } },
    );

    await WhatsAppAccount.deleteOne({ _id: account._id });

    res.json({ ok: true, deletedConversations, deletedMessages });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
