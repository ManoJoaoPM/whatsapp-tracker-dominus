import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware.js';
import Client from '../models/Client.js';

export interface ClientRequest extends AuthRequest {
  currentClient?: any;
}

export const requireClient = async (req: ClientRequest, res: Response, next: NextFunction): Promise<void> => {
  const clientId = req.headers['x-client-id'];

  if (!clientId) {
    res.status(400).json({ message: 'Client ID is required in x-client-id header' });
    return;
  }

  try {
    const client = await Client.findOne({ _id: clientId, userId: req.user.id });
    
    if (!client) {
      res.status(404).json({ message: 'Client not found or you do not have access' });
      return;
    }

    req.currentClient = client;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Error verifying client access' });
  }
};