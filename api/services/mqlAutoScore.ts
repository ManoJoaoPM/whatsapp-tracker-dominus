import Conversation from '../models/Conversation.js';
import type { IConversation } from '../models/Conversation.js';
import Message from '../models/Message.js';
import Client from '../models/Client.js';
import MqlEvaluation from '../models/MqlEvaluation.js';
import { evaluateConversationMql } from './mqlService.js';
import { resolveClientCriteria } from './mqlCriteria.js';
import { applyBusinessRules, levelFromScore } from './mqlEngine.js';
import { hasReachedTriggerLevel } from './metaRetryPolicy.js';
import { enqueueMetaMqlQualifiedConversion } from './metaEventQueue.js';

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const numberFromEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const getMqlSettings = () => ({
  /** quiet time after the last message before the conversation is scored */
  debounceMs: numberFromEnv('MQL_DEBOUNCE_SECONDS', 120) * 1000,
  /** never score the same conversation more often than this */
  minIntervalMs: numberFromEnv('MQL_MIN_INTERVAL_SECONDS', 300) * 1000,
  /** a conversation is only scored for the first time after the lead wrote this many messages */
  minInbound: Math.max(1, Math.floor(numberFromEnv('MQL_MIN_INBOUND', 2))),
  /** lead messages required before an event can go to Meta */
  confirmMinInbound: Math.max(1, Math.floor(numberFromEnv('MQL_CONFIRM_MIN_INBOUND', 2))),
  /** hours without an answer from the lead before the silence re-evaluation */
  silenceHours: numberFromEnv('MQL_SILENCE_HOURS', 48),
  /** consecutive failures before giving up until the next message */
  maxErrors: 3,
  /** a scoring that never finished (crash, deploy) is released after this long */
  stuckMs: 5 * 60 * 1000,
});

export type ScoringTrigger = 'message' | 'silence' | 'manual';

/* ------------------------------------------------------------------ */
/* When to score (pure)                                                */
/* ------------------------------------------------------------------ */

export type ScoringDecision = { run: boolean; reason?: string; rescheduleAt?: Date };

export const decideScoring = (
  conv: Pick<
    IConversation,
    'mqlScore' | 'mqlUpdatedAt' | 'messageCount' | 'inboundMessageCount' | 'mqlLastScoredMessageCount' | 'mqlLastScoredInboundCount'
  >,
  trigger: ScoringTrigger,
  settings: Pick<ReturnType<typeof getMqlSettings>, 'minInbound' | 'minIntervalMs'>,
  now: Date = new Date(),
): ScoringDecision => {
  if (trigger === 'manual') return { run: true };

  const hasScore = typeof conv.mqlScore === 'number';

  // The silence sweep only picks conversations that were already scored
  if (trigger === 'silence') return hasScore ? { run: true } : { run: false, reason: 'never_scored' };

  const inbound = Number(conv.inboundMessageCount || 0);

  if (!hasScore) {
    if (inbound < settings.minInbound) return { run: false, reason: 'waiting_for_more_messages' };
  } else {
    const newInbound = inbound > Number(conv.mqlLastScoredInboundCount || 0);
    const newTotal = Number(conv.messageCount || 0) - Number(conv.mqlLastScoredMessageCount || 0);
    if (!newInbound && newTotal < 3) return { run: false, reason: 'nothing_new' };
  }

  if (conv.mqlUpdatedAt) {
    const earliest = new Date(conv.mqlUpdatedAt).getTime() + settings.minIntervalMs;
    if (earliest > now.getTime()) return { run: false, reason: 'too_soon', rescheduleAt: new Date(earliest) };
  }

  return { run: true };
};

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/**
 * Called whenever a message is stored. It only moves the "due" moment forward; the worker scores
 * the conversation once it has been quiet for the debounce period. Survives restarts because the
 * moment lives in the database.
 */
export const scheduleMqlScoring = async (params: { conversationId: string; clientId: string }): Promise<void> => {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    await Conversation.updateOne(
      { _id: params.conversationId, clientId: params.clientId },
      {
        $set: { mqlDueAt: new Date(Date.now() + getMqlSettings().debounceMs), mqlSilencePending: false, mqlErrorCount: 0 },
      },
    );
  } catch (error: any) {
    console.error('[mql] could not schedule scoring', { conversationId: params.conversationId, error: error?.message || error });
  }
};

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const releaseLock = (id: unknown, extra: Record<string, unknown> = {}) =>
  Conversation.updateOne({ _id: id }, { $set: { mqlScoring: false, ...extra }, $unset: { mqlScoringAt: 1 } });

const loadTranscript = async (conversationId: string) => {
  const recentDesc = await Message.find({ conversationId }).sort({ timestamp: -1 }).limit(80);
  return [...recentDesc].reverse().map((m) => ({
    direction: m.direction,
    content: m.content,
    mediaType: m.mediaType,
    timestamp: m.timestamp,
  }));
};

/**
 * Scores a conversation that is already locked (mqlScoring = true) and persists everything.
 * Throws on failure; the caller releases the lock.
 */
const scoreLockedConversation = async (conv: IConversation, trigger: ScoringTrigger, io?: any): Promise<IConversation | null> => {
  const settings = getMqlSettings();
  const now = new Date();
  const clientId = String(conv.clientId);

  const client = await Client.findById(clientId);
  const criteria = resolveClientCriteria(client);
  const context = String(client?.mqlRules || '');
  const triggerLevel = (client?.metaAds?.mqlTriggerLevel || 'hot') as 'cold' | 'warm' | 'hot';

  const messages = await loadTranscript(String(conv._id));
  const inboundCount = Number(conv.inboundMessageCount || 0);

  // Silence only counts when the company spoke last: a lead waiting for an answer is not "silent"
  let silenceHours: number | null = null;
  if (trigger === 'silence' && conv.lastInboundMessageAt) {
    silenceHours = (now.getTime() - new Date(conv.lastInboundMessageAt).getTime()) / 3_600_000;
  }

  const first = await evaluateConversationMql({
    criteria,
    context,
    messages,
    now,
    silenceHours,
    silenceThresholdHours: settings.silenceHours,
  });

  let criteriaScore = first.score;
  let confirmationScore: number | undefined;
  let confirmed = Boolean(conv.mqlConfirmed);
  let manipulation = first.manipulationAttempt;
  let finalResult = first;

  // A person closing the sale is the strongest confirmation there is
  const closedByPerson = conv.funnelStage === 'closed';

  // Before a lead can reach Meta, a skeptical second opinion must agree with the first one
  const needsConfirmation =
    !confirmed &&
    !closedByPerson &&
    conv.origin === 'meta_ads' &&
    !first.manipulationAttempt &&
    inboundCount >= settings.confirmMinInbound &&
    hasReachedTriggerLevel(first.level, triggerLevel);

  if (needsConfirmation) {
    const second = await evaluateConversationMql({
      criteria,
      context,
      messages,
      now,
      silenceHours,
      silenceThresholdHours: settings.silenceHours,
      skeptical: true,
    });
    confirmationScore = second.score;
    manipulation = manipulation || second.manipulationAttempt;
    // Conservative: when two evaluations ran, the lower score wins
    criteriaScore = Math.min(first.score, second.score);
    if (second.score < first.score) finalResult = second;
    confirmed = !second.manipulationAttempt && hasReachedTriggerLevel(levelFromScore(second.score), triggerLevel);
  }

  if (closedByPerson) confirmed = true;

  const business = applyBusinessRules({ score: criteriaScore, inboundCount, funnelStage: conv.funnelStage });
  const signals = [...finalResult.signals];
  if (business.floorApplied) signals.push('piso_de_engajamento');
  if (business.closedOverride) signals.push('venda_concluida');

  const set: Record<string, unknown> = {
    mqlScore: business.score,
    mqlLevel: business.level,
    mqlSummary: finalResult.summary,
    mqlSignals: signals,
    mqlCriteria: finalResult.criteria,
    mqlConfirmed: confirmed,
    mqlManipulation: manipulation,
    mqlUpdatedAt: now,
    mqlModel: first.model,
    mqlRulesHash: first.rulesHash,
    mqlPromptVersion: first.promptVersion,
    mqlLastScoredMessageCount: Number(conv.messageCount || 0),
    mqlLastScoredInboundCount: inboundCount,
    mqlScoring: false,
    mqlErrorCount: 0,
  };
  if (trigger === 'silence') {
    set.mqlSilenceScoredAt = now;
    set.mqlSilencePending = false;
  }

  // A verified amount found in the conversation is offered as a suggestion when the sale is closed
  const saleSuggestion = finalResult.saleSuggestion ?? first.saleSuggestion;
  if (saleSuggestion) {
    set.saleValueSuggested = saleSuggestion.amount;
    set.saleValueEvidence = saleSuggestion.evidence;
  }

  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id },
    { $set: set, $unset: { mqlLastError: 1, mqlLastErrorAt: 1, mqlScoringAt: 1 } },
    { new: true },
  );

  await MqlEvaluation.create({
    clientId,
    conversationId: conv._id,
    trigger,
    score: business.score,
    level: business.level,
    criteriaScore,
    confirmationScore,
    confirmed,
    floorApplied: business.floorApplied,
    summary: finalResult.summary,
    signals,
    criteria: finalResult.criteria,
    manipulationAttempt: manipulation,
    injectionDetected: first.injectionDetected,
    promptVersion: first.promptVersion,
    modelName: first.model,
    rulesHash: first.rulesHash,
    messageCount: Number(conv.messageCount || 0),
    inboundCount,
  }).catch((err) => {
    console.error('[mql] could not save evaluation history', err?.message || err);
  });

  if (updated?.origin === 'meta_ads') {
    void enqueueMetaMqlQualifiedConversion({ conversationId: updated.id, clientId }).catch((err) => {
      console.error('[mql] could not enqueue Meta event', { conversationId: updated.id, error: err?.message || err });
    });
  }

  if (io && updated) {
    io.to(clientId).emit('mql_updated', { conversation: updated });
  }

  return updated;
};

/* ------------------------------------------------------------------ */
/* Worker path                                                         */
/* ------------------------------------------------------------------ */

const processClaimed = async (conv: IConversation, io?: any): Promise<void> => {
  const settings = getMqlSettings();
  const trigger: ScoringTrigger = conv.mqlSilencePending ? 'silence' : 'message';

  const decision = decideScoring(conv, trigger, settings);
  if (!decision.run) {
    await Conversation.updateOne(
      { _id: conv._id },
      {
        $set: { mqlScoring: false, ...(decision.rescheduleAt ? { mqlDueAt: decision.rescheduleAt } : {}) },
        $unset: { mqlScoringAt: 1 },
      },
    );
    return;
  }

  try {
    await scoreLockedConversation(conv, trigger, io);
  } catch (error: any) {
    const reason = String(error?.message || error).slice(0, 300);
    const errorCount = Number(conv.mqlErrorCount || 0) + 1;
    console.error('[mql] scoring failed', {
      conversationId: String(conv._id),
      attempt: errorCount,
      reason,
      details: error?.details,
    });

    // Temporary provider problems get a few retries with growing waits, then wait for the next message
    const retryAt = errorCount < settings.maxErrors ? new Date(Date.now() + errorCount * 5 * 60 * 1000) : undefined;
    await Conversation.updateOne(
      { _id: conv._id },
      {
        $set: {
          mqlScoring: false,
          mqlLastError: reason,
          mqlLastErrorAt: new Date(),
          mqlErrorCount: errorCount,
          ...(retryAt ? { mqlDueAt: retryAt } : {}),
        },
        $unset: { mqlScoringAt: 1 },
      },
    );
  }
};

export const recoverStuckScoring = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - getMqlSettings().stuckMs);
  const result = await Conversation.updateMany(
    { mqlScoring: true, $or: [{ mqlScoringAt: { $lt: cutoff } }, { mqlScoringAt: { $exists: false } }] },
    { $set: { mqlScoring: false }, $unset: { mqlScoringAt: 1 } },
  );
  return result.modifiedCount ?? 0;
};

export const runMqlWorkerOnce = async (io?: any, limit = 10): Promise<number> => {
  if (!process.env.OPENAI_API_KEY) return 0;

  const recovered = await recoverStuckScoring();
  if (recovered > 0) console.warn(`[mql] released ${recovered} stuck scoring lock(s)`);

  let processed = 0;
  while (processed < limit) {
    const now = new Date();
    const claimed = await Conversation.findOneAndUpdate(
      { mqlDueAt: { $lte: now }, mqlScoring: { $ne: true } },
      { $set: { mqlScoring: true, mqlScoringAt: now }, $unset: { mqlDueAt: 1 } },
      { new: true, sort: { mqlDueAt: 1 } },
    );
    if (!claimed) break;
    processed += 1;
    await processClaimed(claimed, io);
  }
  return processed;
};

/**
 * Marks for re-evaluation the leads that were scored, got a message from the company, and then
 * went silent. Each silence period is evaluated once.
 */
export const runSilenceSweepOnce = async (limit = 50): Promise<number> => {
  if (!process.env.OPENAI_API_KEY) return 0;

  const settings = getMqlSettings();
  const now = Date.now();
  const silentBefore = new Date(now - settings.silenceHours * 3_600_000);
  const notOlderThan = new Date(now - 30 * 24 * 3_600_000);

  const base = {
    mqlScore: { $exists: true },
    mqlDueAt: { $exists: false },
    mqlScoring: { $ne: true },
    funnelStage: { $nin: ['closed', 'lost'] },
    lastInboundMessageAt: { $lt: silentBefore, $gt: notOlderThan },
    $expr: {
      $and: [
        { $gt: ['$lastOutboundMessageAt', '$lastInboundMessageAt'] },
        {
          $or: [
            { $eq: [{ $type: '$mqlSilenceScoredAt' }, 'missing'] },
            { $lt: ['$mqlSilenceScoredAt', '$lastInboundMessageAt'] },
          ],
        },
      ],
    },
  };

  const candidates = await Conversation.find(base).select('_id').limit(limit).lean();
  if (candidates.length === 0) return 0;

  // Same filter again so a message that arrived in between is not overridden
  const result = await Conversation.updateMany(
    { ...base, _id: { $in: candidates.map((c) => c._id) } },
    { $set: { mqlSilencePending: true, mqlDueAt: new Date() } },
  );
  return result.modifiedCount ?? 0;
};

/* ------------------------------------------------------------------ */
/* Manual path (the "Recalcular" button)                               */
/* ------------------------------------------------------------------ */

export class ScoringBusyError extends Error {
  constructor() {
    super('This conversation is already being scored');
  }
}

export const scoreConversationManually = async (params: {
  conversationId: string;
  clientId: string;
  io?: any;
}): Promise<IConversation | null> => {
  const claimed = await Conversation.findOneAndUpdate(
    { _id: params.conversationId, clientId: params.clientId, mqlScoring: { $ne: true } },
    { $set: { mqlScoring: true, mqlScoringAt: new Date() }, $unset: { mqlDueAt: 1 } },
    { new: true },
  );

  if (!claimed) {
    const exists = await Conversation.exists({ _id: params.conversationId, clientId: params.clientId });
    if (!exists) return null;
    throw new ScoringBusyError();
  }

  try {
    return await scoreLockedConversation(claimed, 'manual', params.io);
  } catch (error: any) {
    await releaseLock(claimed._id);
    throw error;
  }
};

/* ------------------------------------------------------------------ */
/* Worker lifecycle                                                    */
/* ------------------------------------------------------------------ */

let scoringTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let scoringRunning = false;
let sweepRunning = false;

/** Needs a long-running process (Docker / `npm run server:dev`); serverless hosts never run it */
export const startMqlWorker = (io?: any): void => {
  if (scoringTimer) return;

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[mql] OPENAI_API_KEY is not set: automatic qualification is disabled');
  }

  const scoringTick = async () => {
    if (scoringRunning) return;
    scoringRunning = true;
    try {
      await runMqlWorkerOnce(io);
    } catch (error: any) {
      console.error('[mql] worker error', error?.message || error);
    } finally {
      scoringRunning = false;
    }
  };

  const sweepTick = async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      const marked = await runSilenceSweepOnce();
      if (marked > 0) console.log(`[mql] silence sweep marked ${marked} conversation(s)`);
    } catch (error: any) {
      console.error('[mql] silence sweep error', error?.message || error);
    } finally {
      sweepRunning = false;
    }
  };

  scoringTimer = setInterval(() => void scoringTick(), 20_000);
  sweepTimer = setInterval(() => void sweepTick(), 10 * 60_000);
  scoringTimer.unref?.();
  sweepTimer.unref?.();
  void scoringTick();
  console.log('[mql] worker started (scoring every 20s, silence sweep every 10min)');
};
