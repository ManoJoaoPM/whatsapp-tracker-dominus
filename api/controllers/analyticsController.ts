import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';

export const getAnalytics = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.currentClient.id;

    // Filter by period (optional, MVP can just use all time or specific days)
    // For now, let's just get all time to keep it simple as per MVP rules
    const filter: any = { clientId };

    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate as string),
        $lte: new Date(req.query.endDate as string),
      };
    }

    const conversations = await Conversation.find(filter);

    const metrics = {
      totalLeads: conversations.length,
      byOrigin: {
        meta_ads: 0,
        google_ads: 0,
        organic: 0,
        unknown: 0
      },
      byStage: {
        first_contact: 0,
        replied: 0,
        qualified: 0,
        proposal: 0,
        scheduled: 0,
        closed: 0,
        lost: 0
      }
    };

    conversations.forEach(conv => {
      // Count by origin
      if (metrics.byOrigin[conv.origin as keyof typeof metrics.byOrigin] !== undefined) {
        metrics.byOrigin[conv.origin as keyof typeof metrics.byOrigin]++;
      }
      
      // Count by stage
      if (metrics.byStage[conv.funnelStage as keyof typeof metrics.byStage] !== undefined) {
        metrics.byStage[conv.funnelStage as keyof typeof metrics.byStage]++;
      }
    });

    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};