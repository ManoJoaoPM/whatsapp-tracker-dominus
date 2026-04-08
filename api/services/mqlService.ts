import crypto from 'crypto';

export type MqlLevel = 'cold' | 'warm' | 'hot';

export type MqlScoreResult = {
  score: number;
  level: MqlLevel;
  summary: string;
  signals: string[];
  model: string;
  rulesHash: string;
};

const DEFAULT_MQL_RULES_PTBR = `
Objetivo: pontuar o lead em MQL de 0 a 100 baseado na conversa.

Critérios (exemplo padrão — substitua pelas suas regras oficiais):
- Intenção explícita de compra/contratação (+30)
- Urgência / prazo definido (+15)
- Fit básico (segmento/necessidade alinhada) (+15)
- Orçamento mencionado ou aceitação de faixa (+15)
- Tomada de decisão (é o decisor ou envolve decisor) (+10)
- Dados de contato/empresa e contexto suficientes (+10)
- Sinais negativos (sem resposta, curiosidade genérica, fora do escopo, preço como única objeção) (-5 a -30)

Mapeamento de nível:
- cold: 0-39
- warm: 40-69
- hot: 70-100

Saída deve ser objetiva e baseada somente no que está escrito na conversa.
`;

const coerceScore = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
};

const coerceLevel = (value: unknown, score: number): MqlLevel => {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'cold' || v === 'warm' || v === 'hot') return v;
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
};

const safeJsonFromText = (text: string): any => {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('LLM did not return JSON');
  }
  const candidate = text.slice(first, last + 1);
  return JSON.parse(candidate);
};

export const getDefaultMqlRules = (): string => DEFAULT_MQL_RULES_PTBR.trim();

export const hashRules = (rules: string): string => {
  return crypto.createHash('sha256').update(rules, 'utf8').digest('hex');
};

export const scoreConversationMql = async (params: {
  rules?: string;
  transcript: string;
}): Promise<MqlScoreResult> => {
  const rules = (params.rules && String(params.rules).trim()) ? String(params.rules).trim() : getDefaultMqlRules();
  const rulesHash = hashRules(rules);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err: any = new Error('OPENAI_API_KEY not configured');
    err.statusCode = 501;
    throw err;
  }

  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  const system =
    'Você é um avaliador de MQL. Você deve responder SOMENTE com JSON válido, sem texto extra.';

  const user = `
Regras de MQL:
${rules}

Conversa (transcrição):
${params.transcript}

Retorne JSON com este formato exato:
{
  "score": number,
  "level": "cold" | "warm" | "hot",
  "summary": string,
  "signals": string[]
}
`; 

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (e: any) {
    const err: any = new Error('OpenAI request failed');
    err.statusCode = 502;
    err.details = String(e?.message || e);
    throw err;
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const err: any = new Error(`OpenAI request failed (${response.status})`);
    err.statusCode = 502;
    err.details = bodyText.slice(0, 2000);
    throw err;
  }

  const data: any = await response.json();
  const text: string = data?.choices?.[0]?.message?.content || '';
  const parsed = safeJsonFromText(text);

  const score = coerceScore(parsed?.score);
  const level = coerceLevel(parsed?.level, score);
  const summary = String(parsed?.summary || '').trim();
  const signals = Array.isArray(parsed?.signals) ? parsed.signals.map((s: any) => String(s).trim()).filter(Boolean) : [];

  return {
    score,
    level,
    summary,
    signals,
    model,
    rulesHash,
  };
};
