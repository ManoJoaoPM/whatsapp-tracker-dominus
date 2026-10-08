import { Response } from 'express';
import mongoose from 'mongoose';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import {
  buildEvolutionWebhookUrl,
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

    const suffix = new mongoose.Types.ObjectId().toHexString();
    const instanceName = `client_${String(client.id)}_wa_${suffix}`;

    const account = await WhatsAppAccount.create({
      clientId: client.id,
      provider: 'evolution',
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
        await setWebhook(instanceName, buildEvolutionWebhookUrl());
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
