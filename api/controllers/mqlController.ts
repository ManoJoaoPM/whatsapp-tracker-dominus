import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import MqlEvaluation from '../models/MqlEvaluation.js';
import { ScoringBusyError, scoreConversationManually } from '../services/mqlAutoScore.js';
import {
  DEFAULT_TEMPLATE_ID,
  MQL_TEMPLATES,
  getTemplate,
  resolveClientCriteria,
  sanitizeCriteria,
} from '../services/mqlCriteria.js';

const MAX_CONTEXT_CHARS = 2000;

const buildConfig = (client: any) => ({
  rules: String(client?.mqlRules || ''),
  template: String(client?.mqlTemplate || DEFAULT_TEMPLATE_ID),
  customized: Array.isArray(client?.mqlCriteria) && client.mqlCriteria.length > 0,
  criteria: resolveClientCriteria(client),
  templates: MQL_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, criteria: t.criteria })),
});

export const getMqlConfig = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    res.json(buildConfig(req.currentClient));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Body (all optional):
 *  - rules: business context for the evaluator
 *  - template: applies a template (replaces the saved criteria)
 *  - criteria: custom criteria (replaces the saved criteria)
 */
export const updateMqlConfig = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const client = req.currentClient;
    const { rules, template, criteria } = req.body || {};

    if (rules === undefined && template === undefined && criteria === undefined) {
      res.status(400).json({ message: 'rules, template or criteria is required' });
      return;
    }

    if (rules !== undefined) {
      if (typeof rules !== 'string' || rules.length > MAX_CONTEXT_CHARS) {
        res.status(400).json({ message: `rules must be a string of up to ${MAX_CONTEXT_CHARS} characters` });
        return;
      }
      client.mqlRules = rules.trim();
    }

    if (criteria !== undefined) {
      const checked = sanitizeCriteria(criteria);
      if (!checked.ok) {
        res.status(400).json({ message: checked.error });
        return;
      }
      client.mqlCriteria = checked.criteria;
      if (typeof template === 'string') client.mqlTemplate = getTemplate(template).id;
    } else if (template !== undefined) {
      if (typeof template !== 'string' || !MQL_TEMPLATES.some((t) => t.id === template)) {
        res.status(400).json({ message: 'unknown template' });
        return;
      }
      client.mqlTemplate = template;
      client.mqlCriteria = getTemplate(template).criteria;
    }

    await client.save();
    res.json(buildConfig(client));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/** Kept for compatibility: the "rules" are now the business context */
export const getMqlRules = async (req: ClientRequest, res: Response): Promise<void> => {
  res.json({ rules: String(req.currentClient?.mqlRules || '') });
};

export const updateMqlRules = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const rules = String(req.body?.rules || '').trim();
    if (!rules || rules.length > MAX_CONTEXT_CHARS) {
      res.status(400).json({ message: `rules is required (up to ${MAX_CONTEXT_CHARS} characters)` });
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
    const conversation = await scoreConversationManually({
      conversationId: String(req.params.id),
      clientId: String(req.currentClient.id),
      io: req.app.get('io'),
    });

    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    res.json({
      conversation,
      result: {
        score: conversation.mqlScore,
        level: conversation.mqlLevel,
        summary: conversation.mqlSummary,
        signals: conversation.mqlSignals,
        criteria: conversation.mqlCriteria,
        confirmed: conversation.mqlConfirmed,
      },
    });
  } catch (error: any) {
    if (error instanceof ScoringBusyError) {
      res.status(409).json({ message: error.message });
      return;
    }
    const statusCode = Number(error?.statusCode) || 500;
    res.status(statusCode).json({ message: error.message, details: error.details });
  }
};

/** History of evaluations of one conversation (audit trail) */
export const getConversationEvaluations = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const evaluations = await MqlEvaluation.find({
      conversationId: String(req.params.id),
      clientId: req.currentClient._id,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json(evaluations);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
