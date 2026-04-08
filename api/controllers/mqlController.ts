import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { getDefaultMqlRules, scoreConversationMql } from '../services/mqlService.js';

const buildTranscript = (messages: Array<{ direction: string; content: string; mediaType: string; timestamp: Date }>): string => {
  return messages
    .map((m) => {
      const who = m.direction === 'outbound' ? 'Empresa' : 'Lead';
      const ts = m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp);
      const content = String(m.content || '').replace(/\s+/g, ' ').trim();
      const media = m.mediaType && m.mediaType !== 'text' ? ` [${m.mediaType}]` : '';
      return `[${ts}] ${who}${media}: ${content}`;
    })
    .join('\n');
};

export const getMqlRules = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const rules = String(req.currentClient?.mqlRules || '').trim() || getDefaultMqlRules();
    res.json({ rules });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateMqlRules = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const rules = String(req.body?.rules || '').trim();
    if (!rules) {
      res.status(400).json({ message: 'rules is required' });
      return;
    }

    req.currentClient.mqlRules = rules;
    await req.currentClient.save();
    res.json({ rules });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const scoreConversation = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id });
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const rules = String(req.currentClient?.mqlRules || '').trim() || getDefaultMqlRules();
    const recentDesc = await Message.find({ conversationId: conversation.id }).sort({ timestamp: -1 }).limit(80);
    const messages = [...recentDesc].reverse();
    const transcript = buildTranscript(messages as any);

    const result = await scoreConversationMql({ rules, transcript });

    conversation.mqlScore = result.score;
    conversation.mqlLevel = result.level;
    conversation.mqlSummary = result.summary;
    conversation.mqlSignals = result.signals;
    conversation.mqlUpdatedAt = new Date();
    conversation.mqlModel = result.model;
    conversation.mqlRulesHash = result.rulesHash;
    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      io.to(req.currentClient.id).emit('mql_updated', { conversation });
    }

    res.json({ conversation, result });
  } catch (error: any) {
    const statusCode = Number(error?.statusCode) || 500;
    res.status(statusCode).json({ message: error.message, details: error.details });
  }
};
