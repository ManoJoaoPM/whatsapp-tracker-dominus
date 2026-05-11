import { Response } from 'express';
import mongoose from 'mongoose';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import {
  connectInstance,
  createInstance,
  getConnectionState,
  logoutInstance,
  setWebhook,
} from '../services/evolutionService.js';

const extractQrCode = (payload: any) => {
  return (
    payload?.qrcode?.base64 ||
    payload?.qrcode?.code ||
    payload?.qrcode ||
    payload?.base64 ||
    payload?.code ||
    null
  );
};

const mapEvolutionStateToStatus = (state: any): 'connected' | 'disconnected' | 'pending' => {
  const s = state?.instance?.state;
  if (s === 'open') return 'connected';
  if (s === 'close') return 'disconnected';
  return 'pending';
};

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

    const suffix = new mongoose.Types.ObjectId().toHexString();
    const instanceName = `client_${String(client.id)}_wa_${suffix}`;

    const account = await WhatsAppAccount.create({
      clientId: client.id,
      displayName: displayName || undefined,
      instanceId: instanceName,
      status: 'pending',
    });

    const existingState = await getConnectionState(instanceName);

    let qrCode: string | null = null;

    if (!existingState) {
      try {
        const newInstance = await createInstance(instanceName);
        qrCode = extractQrCode(newInstance);
        const webhookUrl = `${process.env.APP_URL}/api/webhooks/evolution`;
        await setWebhook(instanceName, webhookUrl);
        if (!qrCode) {
          const connectRes = await connectInstance(instanceName);
          qrCode = extractQrCode(connectRes);
        }
      } catch (err: any) {
        if (err?.message === 'Instance already exists') {
          try {
            const connectRes = await connectInstance(instanceName);
            qrCode = extractQrCode(connectRes);
          } catch {
          }
        } else {
          throw err;
        }
      }
    } else {
      qrCode = extractQrCode(existingState);
      if (!qrCode && existingState?.instance?.state !== 'open') {
        try {
          const connectRes = await connectInstance(instanceName);
          qrCode = extractQrCode(connectRes);
        } catch {
        }
      }
      const nextStatus = mapEvolutionStateToStatus(existingState);
      if (nextStatus !== account.status) {
        account.status = nextStatus;
        await account.save();
      }
    }

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

    const state = await getConnectionState(account.instanceId);
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

    await logoutInstance(account.instanceId);
    account.status = 'disconnected';
    await account.save();

    res.json({ message: 'Disconnected successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

