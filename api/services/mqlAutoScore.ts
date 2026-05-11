import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { getDefaultMqlRules, scoreConversationMql } from './mqlService.js';
import Client from '../models/Client.js';
import { trySendMetaMqlQualifiedConversion } from './metaConversions.js';

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
  const inboundMessageCount = Number(conversation?.inboundMessageCount || 0);
  const lastScoredAtCount = Number(conversation?.mqlLastScoredMessageCount || 0);
  const hasScore = typeof conversation?.mqlScore === 'number';
  
  if (!hasScore) return true;

  // Forçar recálculo imediato quando atingir 4 mensagens recebidas do lead
  // para garantir a regra de "MQL quando responde 4-5x"
  if (inboundMessageCount === 4 && (conversation.mqlScore || 0) < 40) return true;

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
    const previousLevel = claimed.mqlLevel;

    const client = await Client.findById(params.clientId);
    const rules = String(client?.mqlRules || '').trim() || getDefaultMqlRules();

    const recentDesc = await Message.find({ conversationId: claimed.id }).sort({ timestamp: -1 }).limit(80);
    const messages = [...recentDesc].reverse();
    const transcript = buildTranscript(messages as any);
    const result = await scoreConversationMql({ rules, transcript });

    let finalScore = result.score;
    let finalLevel = result.level;

    // Regras Hardcoded de MQL solicitadas pelo usuário:
    // 1. É MQL quando o lead responde 4-5x (score mínimo de 40 - warm)
    const inboundCount = Number(claimed.inboundMessageCount || 0);
    if (inboundCount >= 4 && finalScore < 40) {
      finalScore = 40;
      finalLevel = 'warm';
    }

    // 2. Todo lead acima de 70% de MQL será considerado como lead quente
    if (finalScore >= 70) {
      finalLevel = 'hot';
    }

    // 3. Todo lead que comprar será 100% qualificado e quente
    if (claimed.funnelStage === 'closed') {
      finalScore = 100;
      finalLevel = 'hot';
    }

    claimed.mqlScore = finalScore;
    claimed.mqlLevel = finalLevel;
    claimed.mqlSummary = result.summary;
    claimed.mqlSignals = result.signals;
    claimed.mqlUpdatedAt = new Date();
    claimed.mqlModel = result.model;
    claimed.mqlRulesHash = result.rulesHash;
    claimed.mqlLastScoredMessageCount = Number(claimed.messageCount || 0);
    claimed.mqlScoring = false;
    await claimed.save();

    if (claimed.origin === 'meta_ads') {
      void trySendMetaMqlQualifiedConversion({
        conversationId: claimed.id,
        clientId: params.clientId,
        previousLevel,
        nextLevel: claimed.mqlLevel,
      });
    }

    if (params.io) {
      params.io.to(params.clientId).emit('mql_updated', { conversation: claimed });
    }
  } catch {
    await Conversation.updateOne({ _id: claimed._id }, { $set: { mqlScoring: false } });
  }
};
