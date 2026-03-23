import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware.js';
import Client from '../models/Client.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import OriginEvent from '../models/OriginEvent.js';
import { logoutInstance } from '../services/evolutionService.js';

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

    const client = await Client.findOne({ _id: id, userId: req.user.id });

    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    // Se o cliente tem uma instância do WhatsApp conectada/pendente, tenta deslogar e excluir na Evolution API
    if (client.whatsappInstance?.instanceId) {
      try {
        await logoutInstance(client.whatsappInstance.instanceId);
      } catch (e) {
        console.error('Erro ao tentar deslogar instância do WhatsApp ao deletar cliente:', e);
      }
    }

    // Deletar mensagens associadas a este cliente
    await Message.deleteMany({ clientId: id });
    
    // Deletar conversas associadas a este cliente
    await Conversation.deleteMany({ clientId: id });

    // Deletar eventos de origem associados a este cliente
    await OriginEvent.deleteMany({ clientId: id });

    // Por fim, deletar o cliente
    await client.deleteOne();

    res.json({ message: 'Client and all associated data removed' });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};