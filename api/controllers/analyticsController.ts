import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';

export const getAnalytics = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const clientId = req.currentClient.id;

    const filter: any = { clientId };

    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate as string),
        $lte: new Date(req.query.endDate as string),
      };
    }

    const [totalLeads, byOriginAgg, byStageAgg, mqlAgg, topLeads] = await Promise.all([
      Conversation.countDocuments(filter),
      Conversation.aggregate([
        { $match: filter },
        { $group: { _id: '$origin', count: { $sum: 1 } } }
      ]),
      Conversation.aggregate([
        { $match: filter },
        { $group: { _id: '$funnelStage', count: { $sum: 1 } } }
      ]),
      Conversation.aggregate([
        { $match: { ...filter, mqlScore: { $ne: null } } },
        { $group: { _id: null, avgScore: { $avg: '$mqlScore' }, scoredLeads: { $sum: 1 } } }
      ]),
      Conversation.aggregate([
        { $match: filter },
        {
          $addFields: {
            hasMqlScore: { $cond: [{ $ne: ['$mqlScore', null] }, 1, 0] }
          }
        },
        { $sort: { hasMqlScore: -1, mqlScore: -1, lastMessageAt: -1 } },
        { $limit: 20 },
        {
          $project: {
            contactName: 1,
            contactPhone: 1,
            origin: 1,
            funnelStage: 1,
            mqlScore: 1,
            mqlLevel: 1,
            lastMessageAt: 1
          }
        }
      ])
    ]);

    const byOrigin = {
      meta_ads: 0,
      google_ads: 0,
      organic: 0,
      unknown: 0
    };

    for (const item of byOriginAgg) {
      const key = item?._id as keyof typeof byOrigin;
      if (key && byOrigin[key] !== undefined) {
        byOrigin[key] = item.count;
      }
    }

    const byStage = {
      first_contact: 0,
      replied: 0,
      qualified: 0,
      proposal: 0,
      scheduled: 0,
      closed: 0,
      lost: 0
    };

    for (const item of byStageAgg) {
      const key = item?._id as keyof typeof byStage;
      if (key && byStage[key] !== undefined) {
        byStage[key] = item.count;
      }
    }

    const avgScoreRaw = mqlAgg?.[0]?.avgScore;
    const avgScore = typeof avgScoreRaw === 'number' ? Number(avgScoreRaw.toFixed(1)) : null;

    res.json({
      totalLeads,
      byOrigin,
      byStage,
      mql: {
        avgScore,
        scoredLeads: mqlAgg?.[0]?.scoredLeads ?? 0
      },
      topLeads
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
