import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware.js';
import Client from '../models/Client.js';

export const getClients = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const clients = await Client.find({ userId: req.user.id });
    res.json(clients);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name } = req.body;

    const client = await Client.create({
      name,
      userId: req.user.id,
    });

    res.status(201).json(client);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const client = await Client.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { name },
      { new: true }
    );

    if (client) {
      res.json(client);
    } else {
      res.status(404).json({ message: 'Client not found' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const client = await Client.findOneAndDelete({ _id: id, userId: req.user.id });

    if (client) {
      res.json({ message: 'Client removed' });
    } else {
      res.status(404).json({ message: 'Client not found' });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};