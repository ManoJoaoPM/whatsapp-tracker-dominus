import mongoose from 'mongoose';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import type { IWhatsAppAccount } from '../models/WhatsAppAccount.js';
import {
  buildEvolutionWebhookUrl,
  connectInstance,
  createInstance,
  getConnectionState,
  setWebhook,
} from './evolutionService.js';

export const extractQrCode = (payload: any): string | null => {
  return (
    payload?.qrcode?.base64 ||
    payload?.qrcode?.code ||
    payload?.qrcode ||
    payload?.base64 ||
    payload?.code ||
    null
  );
};

export const mapEvolutionStateToStatus = (state: any): 'connected' | 'disconnected' | 'pending' => {
  const s = state?.instance?.state;
  if (s === 'open') return 'connected';
  if (s === 'close') return 'disconnected';
  return 'pending';
};

/**
 * Creates a WhatsApp (Evolution) connection for a company: the account record, the Evolution
 * instance, its webhook and the first QR code. Used by the panel and by the public link.
 *
 * If Evolution fails, the account record is removed so no orphan "pending" connections pile up.
 */
export const provisionEvolutionAccount = async (params: {
  clientId: string;
  displayName?: string;
}): Promise<{ account: IWhatsAppAccount; qrCode: string | null }> => {
  const suffix = new mongoose.Types.ObjectId().toHexString();
  const instanceName = `client_${params.clientId}_wa_${suffix}`;

  const account = await WhatsAppAccount.create({
    clientId: params.clientId,
    provider: 'evolution',
    displayName: params.displayName || undefined,
    instanceId: instanceName,
    status: 'pending',
  });

  try {
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
            // the caller can ask for a new QR code
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
          // the caller can ask for a new QR code
        }
      }
      const nextStatus = mapEvolutionStateToStatus(existingState);
      if (nextStatus !== account.status) {
        account.status = nextStatus;
        await account.save();
      }
    }

    return { account, qrCode };
  } catch (error) {
    await WhatsAppAccount.deleteOne({ _id: account._id }).catch(() => undefined);
    throw error;
  }
};
