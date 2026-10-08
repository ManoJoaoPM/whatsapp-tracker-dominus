import type { MqlCriterion } from './mqlCriteria.js';
import { rulesFingerprint } from './mqlCriteria.js';
import {
  MQL_PROMPT_VERSION,
  MQL_RESPONSE_SCHEMA,
  applySilencePenalty,
  buildSystemPrompt,
  buildUserPrompt,
  computeScore,
  levelFromScore,
  parseModelJson,
  prepareMessages,
  verifyCriteria,
  verifySaleSuggestion,
  type MqlLevel,
  type TranscriptMessage,
  type VerifiedCriterion,
} from './mqlEngine.js';

export type CompleteFn = (system: string, user: string) => Promise<string>;

export type MqlEvaluationResult = {
  /** sum of the weights of the verified criteria (before product rules such as the engagement floor) */
  score: number;
  level: MqlLevel;
  summary: string;
  signals: string[];
  criteria: VerifiedCriterion[];
  /** amount of a closed sale found in the conversation (verified quote); a suggestion only */
  saleSuggestion: { amount: number; evidence: string } | null;
  /** the model reported it, or a lead message tried to instruct the evaluator */
  manipulationAttempt: boolean;
  /** a lead message matched the injection patterns */
  injectionDetected: boolean;
  model: string;
  promptVersion: string;
  rulesHash: string;
};

export const getModelName = (): string => (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

const requestError = (message: string, statusCode: number, details?: string) => {
  const err: any = new Error(message);
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
};

/**
 * Some OpenAI-compatible providers reject `response_format` json_schema or a custom temperature.
 * We try the strictest request first and remember the simplest one that works.
 */
type Compatibility = 'full' | 'no_schema' | 'minimal';
let compatibility: Compatibility = 'full';
const ORDER: Compatibility[] = ['full', 'no_schema', 'minimal'];

const openAiComplete: CompleteFn = async (system, user) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw requestError('OPENAI_API_KEY not configured', 501);

  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const buildBody = (level: Compatibility) => ({
    model: getModelName(),
    messages,
    ...(level !== 'minimal' ? { temperature: 0 } : {}),
    ...(level === 'full'
      ? { response_format: { type: 'json_schema', json_schema: { name: 'mql_evaluation', strict: true, schema: MQL_RESPONSE_SCHEMA } } }
      : {}),
  });

  for (let i = ORDER.indexOf(compatibility); i < ORDER.length; i += 1) {
    const level = ORDER[i];

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(level)),
      });
    } catch (e: any) {
      throw requestError('OpenAI request failed', 502, String(e?.message || e));
    }

    if (response.ok) {
      compatibility = level;
      const data: any = await response.json();
      return String(data?.choices?.[0]?.message?.content || '');
    }

    const bodyText = await response.text().catch(() => '');
    const canDegrade = response.status === 400 && i < ORDER.length - 1;
    if (!canDegrade) {
      throw requestError(`OpenAI request failed (${response.status})`, 502, bodyText.slice(0, 2000));
    }
  }

  throw requestError('OpenAI request failed', 502);
};

/**
 * Judges the criteria with the model, then verifies every quote and computes the score on the
 * server. Nothing the model or the lead says can set the score directly.
 */
export const evaluateConversationMql = async (params: {
  criteria: MqlCriterion[];
  /** business context written by the company (what is sold, ideal customer) */
  context?: string;
  messages: TranscriptMessage[];
  now?: Date;
  /** hours since the last LEAD message; only passed by the silence sweep */
  silenceHours?: number | null;
  silenceThresholdHours?: number;
  /** adversarial second opinion used to confirm a lead before it is sent to Meta */
  skeptical?: boolean;
  complete?: CompleteFn;
}): Promise<MqlEvaluationResult> => {
  const complete = params.complete ?? openAiComplete;
  const context = params.context ?? '';
  const prepared = prepareMessages(params.messages);
  const injectionDetected = prepared.some((m) => m.injected);

  const text = await complete(
    buildSystemPrompt({ skeptical: params.skeptical }),
    buildUserPrompt({
      criteria: params.criteria,
      context,
      prepared,
      now: params.now ?? new Date(),
      silenceHours: params.silenceHours,
      reverseCriteria: params.skeptical,
    }),
  );

  const parsed = parseModelJson(text);
  let verified = verifyCriteria(params.criteria, parsed.criteria, prepared);
  verified = applySilencePenalty(verified, params.silenceHours, params.silenceThresholdHours ?? 48);

  const score = computeScore(verified);
  const manipulationAttempt = parsed.manipulationAttempt || injectionDetected;

  const signals = [...parsed.signals];
  if (manipulationAttempt && !signals.includes('tentativa_de_manipulacao')) signals.push('tentativa_de_manipulacao');

  return {
    score,
    level: levelFromScore(score),
    summary: parsed.summary,
    signals,
    criteria: verified,
    saleSuggestion: verifySaleSuggestion(parsed.saleAmount, parsed.saleEvidence, prepared),
    manipulationAttempt,
    injectionDetected,
    model: getModelName(),
    promptVersion: MQL_PROMPT_VERSION,
    rulesHash: rulesFingerprint(params.criteria, context),
  };
};
