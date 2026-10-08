import crypto from 'crypto';

/**
 * Qualification criteria. The AI never produces the score: it only judges each criterion
 * (met / not met + a literal quote). The server verifies the quote and sums the weights,
 * so the score is explainable and cannot be set by whatever the lead writes.
 */

/** `lead`: the quote must be written by the lead. `any`: a company message may prove it (e.g. a confirmed booking). */
export type MqlCriterionSource = 'lead' | 'any';

export type MqlCriterion = {
  id: string;
  label: string;
  description: string;
  /** Points added when met. Negative values are penalties. */
  weight: number;
  source: MqlCriterionSource;
};

export type MqlTemplate = {
  id: string;
  name: string;
  description: string;
  criteria: MqlCriterion[];
};

export const MAX_CRITERIA = 12;
export const MAX_WEIGHT = 50;

const NEGATIVE_CRITERIA: MqlCriterion[] = [
  {
    id: 'disinterest',
    label: 'Sem interesse',
    description: 'Diz que não quer, que não tem interesse, que está só olhando, ou pede para parar de receber mensagens.',
    weight: -30,
    source: 'lead',
  },
  {
    id: 'out_of_scope',
    label: 'Fora do escopo',
    description: 'Procura algo que a empresa não oferece, ou é engano, spam, vaga de emprego ou oferta de fornecedor.',
    weight: -30,
    source: 'lead',
  },
];

export const MQL_TEMPLATES: MqlTemplate[] = [
  {
    id: 'generic',
    name: 'Genérico',
    description: 'Qualquer negócio que vende por conversa.',
    criteria: [
      { id: 'intent', label: 'Intenção de compra', description: 'Diz que quer comprar, contratar, agendar ou avançar com a oferta, e não apenas pedir uma informação genérica.', weight: 30, source: 'lead' },
      { id: 'urgency', label: 'Urgência ou prazo', description: 'Menciona um prazo, uma data ou uma necessidade imediata.', weight: 15, source: 'lead' },
      { id: 'fit', label: 'Necessidade alinhada', description: 'O que procura corresponde ao que a empresa oferece.', weight: 15, source: 'lead' },
      { id: 'budget', label: 'Orçamento ou pagamento', description: 'Cita um valor disponível, aceita uma faixa de preço ou pergunta sobre forma de pagamento.', weight: 15, source: 'lead' },
      { id: 'decision', label: 'Poder de decisão', description: 'É quem decide a compra ou diz que o decisor participa da conversa.', weight: 10, source: 'lead' },
      { id: 'context', label: 'Dados e contexto', description: 'Informa nome, empresa, local ou detalhes concretos do que precisa.', weight: 10, source: 'lead' },
      { id: 'engagement', label: 'Conversa ativa', description: 'Responde às perguntas da empresa com informações úteis, e não só "oi" ou "ok".', weight: 5, source: 'lead' },
      ...NEGATIVE_CRITERIA,
    ],
  },
  {
    id: 'real_estate',
    name: 'Imobiliária',
    description: 'Compra, venda e locação de imóveis.',
    criteria: [
      { id: 'intent', label: 'Quer comprar, alugar ou visitar', description: 'Diz que quer comprar, alugar ou conhecer um imóvel, e não apenas ver fotos ou preços.', weight: 25, source: 'lead' },
      { id: 'urgency', label: 'Prazo para decidir', description: 'Menciona prazo de mudança, data de contrato ou necessidade imediata.', weight: 10, source: 'lead' },
      { id: 'fit', label: 'Imóvel compatível', description: 'Pede tipo de imóvel, região ou características que a imobiliária trabalha.', weight: 15, source: 'lead' },
      { id: 'budget', label: 'Orçamento ou financiamento', description: 'Cita valor, entrada, renda, financiamento, FGTS ou faixa de preço aceita.', weight: 20, source: 'lead' },
      { id: 'decision', label: 'Poder de decisão', description: 'Decide sozinho ou diz que cônjuge/família já está envolvido na decisão.', weight: 5, source: 'lead' },
      { id: 'visit', label: 'Visita pedida ou marcada', description: 'Pede para visitar o imóvel ou confirma data e horário de visita.', weight: 20, source: 'any' },
      { id: 'context', label: 'Dados e contexto', description: 'Informa nome, bairro de interesse, composição familiar ou detalhes concretos do que busca.', weight: 5, source: 'lead' },
      ...NEGATIVE_CRITERIA,
    ],
  },
  {
    id: 'services',
    name: 'Serviços com agendamento',
    description: 'Clínicas, estética, consultórios, oficinas e similares.',
    criteria: [
      { id: 'intent', label: 'Quer agendar ou contratar', description: 'Diz que quer marcar horário, fazer o procedimento ou contratar o serviço.', weight: 25, source: 'lead' },
      { id: 'urgency', label: 'Urgência', description: 'Precisa para esta semana, tem uma dor ou problema atual, ou menciona uma data próxima.', weight: 15, source: 'lead' },
      { id: 'fit', label: 'Serviço compatível', description: 'Pede um serviço que a empresa realmente oferece.', weight: 15, source: 'lead' },
      { id: 'budget', label: 'Preço ou convênio', description: 'Pergunta ou aceita valor, forma de pagamento ou convênio.', weight: 10, source: 'lead' },
      { id: 'booked', label: 'Horário marcado', description: 'Há um horário ou data confirmados para atendimento.', weight: 25, source: 'any' },
      { id: 'context', label: 'Dados e contexto', description: 'Informa nome, queixa, necessidade ou histórico relevante.', weight: 10, source: 'lead' },
      ...NEGATIVE_CRITERIA,
    ],
  },
  {
    id: 'education',
    name: 'Cursos e infoprodutos',
    description: 'Cursos, mentorias, comunidades e produtos digitais.',
    criteria: [
      { id: 'intent', label: 'Quer comprar ou se inscrever', description: 'Diz que quer entrar, se inscrever ou comprar, e não só saber do que se trata.', weight: 30, source: 'lead' },
      { id: 'fit', label: 'Objetivo alinhado', description: 'O objetivo que descreve é o que o produto entrega.', weight: 20, source: 'lead' },
      { id: 'budget', label: 'Aceita preço ou pagamento', description: 'Aceita o valor, pergunta parcelamento ou forma de pagamento para fechar.', weight: 20, source: 'lead' },
      { id: 'urgency', label: 'Quer começar logo', description: 'Quer começar agora ou menciona data limite, turma ou oferta.', weight: 10, source: 'lead' },
      { id: 'decision', label: 'Poder de decisão', description: 'Decide a compra por conta própria.', weight: 10, source: 'lead' },
      { id: 'engagement', label: 'Conversa ativa', description: 'Responde às perguntas com informações úteis.', weight: 5, source: 'lead' },
      { id: 'context', label: 'Dados e contexto', description: 'Informa área de atuação, experiência ou situação atual.', weight: 5, source: 'lead' },
      ...NEGATIVE_CRITERIA,
    ],
  },
];

export const DEFAULT_TEMPLATE_ID = 'generic';

export const getTemplate = (id: unknown): MqlTemplate => {
  return MQL_TEMPLATES.find((t) => t.id === id) ?? MQL_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
};

export type CriteriaValidation = { ok: boolean; criteria: MqlCriterion[]; error: string };

const invalid = (error: string): CriteriaValidation => ({ ok: false, criteria: [], error });

/** Validates and normalises criteria coming from the API. Never trusts the input shape. */
export const sanitizeCriteria = (input: unknown): CriteriaValidation => {
  if (!Array.isArray(input)) return invalid('criteria must be a list');
  if (input.length === 0) return invalid('at least one criterion is required');
  if (input.length > MAX_CRITERIA) return invalid(`at most ${MAX_CRITERIA} criteria are allowed`);

  const seen = new Set<string>();
  const criteria: MqlCriterion[] = [];

  for (const raw of input) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
    const weight = typeof raw?.weight === 'number' ? raw.weight : Number(raw?.weight);
    const source = raw?.source === 'any' ? 'any' : raw?.source === 'lead' ? 'lead' : null;

    if (!/^[a-z][a-z0-9_]{1,31}$/.test(id)) return invalid(`invalid criterion id "${id}" (use a-z, 0-9 and _)`);
    if (seen.has(id)) return invalid(`duplicate criterion id "${id}"`);
    if (!label || label.length > 80) return invalid(`criterion "${id}" needs a label of up to 80 characters`);
    if (!description || description.length > 400) return invalid(`criterion "${id}" needs a description of up to 400 characters`);
    if (!Number.isInteger(weight) || Math.abs(weight) > MAX_WEIGHT || weight === 0) {
      return invalid(`criterion "${id}" needs a non-zero integer weight between -${MAX_WEIGHT} and ${MAX_WEIGHT}`);
    }
    if (!source) return invalid(`criterion "${id}" needs source "lead" or "any"`);

    seen.add(id);
    criteria.push({ id, label, description, weight, source });
  }

  if (!criteria.some((c) => c.weight > 0)) return invalid('at least one criterion must have a positive weight');

  return { ok: true, criteria, error: '' };
};

/** Criteria saved by the client, or the template default */
export const resolveClientCriteria = (client: { mqlCriteria?: unknown; mqlTemplate?: unknown } | null | undefined): MqlCriterion[] => {
  const saved = sanitizeCriteria(client?.mqlCriteria);
  if (saved.ok) return saved.criteria;
  return getTemplate(client?.mqlTemplate).criteria;
};

/** Identifies the exact rule set used for an evaluation */
export const rulesFingerprint = (criteria: MqlCriterion[], context: string): string => {
  const payload = JSON.stringify({
    criteria: criteria.map((c) => [c.id, c.weight, c.source, c.label, c.description]),
    context: context.trim(),
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
};
