import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Client from '../models/Client.js';
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

export const connectWhatsApp = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = req.currentClient;
    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    const instanceName = `client_${client.id}`;
    
    // Check if instance already exists in Evolution API
    const existingState = await getConnectionState(instanceName);
    
    let qrCode = null;

    if (!existingState) {
      try {
        // Create new instance
        const newInstance = await createInstance(instanceName);
        qrCode = extractQrCode(newInstance);
        
        // Set Webhook
        const webhookUrl = `${process.env.APP_URL}/api/webhooks/evolution`;
        await setWebhook(instanceName, webhookUrl);

        if (!qrCode) {
          const connectRes = await connectInstance(instanceName);
          qrCode = extractQrCode(connectRes);
        }
      } catch (err: any) {
         if (err.message === 'Instance already exists') {
            // It might exist but the connectionState check failed or returned 404
            console.log('Instance exists but state check failed. Trying to fetch it again or generating new qr code.');
            try {
              const connectRes = await connectInstance(instanceName);
              qrCode = extractQrCode(connectRes);
            } catch (e) {
              console.error('Failed to get qrcode for existing instance', e);
            }
         } else {
             console.error('Error in createInstance block:', err);
             throw err;
         }
      }
    } else {
      // If it exists but disconnected, try to get connection state again to see if we have a qr code
      qrCode = extractQrCode(existingState);
      
      // If no qrcode in state, we might need to call connect to generate a new one
      if (!qrCode && existingState?.instance?.state !== 'open') {
         try {
           const connectRes = await connectInstance(instanceName);
           qrCode = extractQrCode(connectRes);
         } catch (e) {
           console.error('Failed to get new qrcode for existing instance', e);
         }
      }
    }

    client.whatsappInstance = {
      instanceId: instanceName,
      status: 'pending'
    };
    await client.save();

    res.json({
      instanceName,
      qrCode: qrCode,
      status: 'pending'
    });
  } catch (error: any) {
    console.error('Error connecting WhatsApp:', error);
    res.status(500).json({ message: error.message || 'Internal server error' });
  }
};

export const getStatus = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = req.currentClient;
    if (!client || !client.whatsappInstance?.instanceId) {
      res.status(404).json({ message: 'Instance not found' });
      return;
    }

    const state = await getConnectionState(client.whatsappInstance.instanceId);
    
    // Update DB if state changed
    let currentStatus = client.whatsappInstance.status;
    let qrCode = null;
    
    if (state?.instance?.state === 'open') {
      currentStatus = 'connected';
    } else if (state?.instance?.state === 'close') {
      currentStatus = 'disconnected';
    } else if (state?.instance?.state === 'connecting') {
      currentStatus = 'pending';
    }

    qrCode = extractQrCode(state);

    if (!qrCode && state?.instance?.state !== 'open') {
      try {
        const connectRes = await connectInstance(client.whatsappInstance.instanceId);
        qrCode = extractQrCode(connectRes);
      } catch {
      }
    }

    if (currentStatus !== client.whatsappInstance.status) {
      client.whatsappInstance.status = currentStatus as any;
      await client.save();
    }

    res.json({
      status: currentStatus,
      qrCode: qrCode
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const disconnectWhatsApp = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = req.currentClient;
    if (!client || !client.whatsappInstance?.instanceId) {
      res.status(404).json({ message: 'Instance not found' });
      return;
    }

    await logoutInstance(client.whatsappInstance.instanceId);
    
    client.whatsappInstance.status = 'disconnected';
    await client.save();

    res.json({ message: 'Disconnected successfully' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
