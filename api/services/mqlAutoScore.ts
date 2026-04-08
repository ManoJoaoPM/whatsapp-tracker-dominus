import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { getDefaultMqlRules, scoreConversationMql } from './mqlService.js';
import Client from '../models/Client.js';

const getRecalcEvery = (): number => {
  const n = Number(process.env.MQL_RECALC_EVERY || 50);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.floor(n);
};

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

export const shouldAutoScoreMql = (conversation: any): boolean => {
  const recalcEvery = getRecalcEvery();
  const messageCount = Number(conversation?.messageCount || 0);
  const lastScoredAtCount = Number(conversation?.mqlLastScoredMessageCount || 0);
  const hasScore = typeof conversation?.mqlScore === 'number';
  if (!hasScore) return true;
  return messageCount - lastScoredAtCount >= recalcEvery;
};

export const tryAutoScoreMql = async (params: {
  conversationId: string;
  clientId: string;
  io?: any;
}): Promise<void> => {
  if (!process.env.OPENAI_API_KEY) return;

  const claimed = await Conversation.findOneAndUpdate(
    { _id: params.conversationId, clientId: params.clientId, mqlScoring: { $ne: true } },
    { $set: { mqlScoring: true } },
    { new: true },
  );

  if (!claimed) return;
  if (!shouldAutoScoreMql(claimed)) {
    await Conversation.updateOne({ _id: claimed._id }, { $set: { mqlScoring: false } });
    return;
  }

  try {
    const client = await Client.findById(params.clientId);
    const rules = String(client?.mqlRules || '').trim() || getDefaultMqlRules();

    const recentDesc = await Message.find({ conversationId: claimed.id }).sort({ timestamp: -1 }).limit(80);
    const messages = [...recentDesc].reverse();
    const transcript = buildTranscript(messages as any);
    const result = await scoreConversationMql({ rules, transcript });

    claimed.mqlScore = result.score;
    claimed.mqlLevel = result.level;
    claimed.mqlSummary = result.summary;
    claimed.mqlSignals = result.signals;
    claimed.mqlUpdatedAt = new Date();
    claimed.mqlModel = result.model;
    claimed.mqlRulesHash = result.rulesHash;
    claimed.mqlLastScoredMessageCount = Number(claimed.messageCount || 0);
    claimed.mqlScoring = false;
    await claimed.save();

    if (params.io) {
      params.io.to(params.clientId).emit('mql_updated', { conversation: claimed });
    }
  } catch {
    await Conversation.updateOne({ _id: claimed._id }, { $set: { mqlScoring: false } });
  }
};

