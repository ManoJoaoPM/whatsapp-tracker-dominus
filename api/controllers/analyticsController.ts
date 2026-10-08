import { Response } from 'express';
import mongoose from 'mongoose';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';
import MetaEventLog from '../models/MetaEventLog.js';

export const getAnalytics = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    // ObjectIds, not strings: Mongoose does not cast the filters of aggregate() pipelines
    const clientId = req.currentClient._id;

    const filter: any = { clientId };

    if (typeof req.query.whatsappAccountId === 'string' && req.query.whatsappAccountId) {
      if (!mongoose.isValidObjectId(req.query.whatsappAccountId)) {
        res.status(400).json({ message: 'Invalid whatsappAccountId' });
        return;
      }
      filter.whatsappAccountId = new mongoose.Types.ObjectId(req.query.whatsappAccountId);
    }

    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';

    if (from || to) {
      filter.lastMessageAt = {};
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) filter.lastMessageAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) filter.lastMessageAt.$lte = d;
      }
      if (Object.keys(filter.lastMessageAt).length === 0) {
        delete filter.lastMessageAt;
      }
    }

    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: new Date(req.query.startDate as string),
        $lte: new Date(req.query.endDate as string),
      };
    }

    const metaFilter = { ...filter, origin: 'meta_ads' };
    const present = { $exists: true, $nin: [null, ''] };

    const [
      totalLeads,
      byOriginAgg,
      byStageAgg,
      mqlAgg,
      topLeads,
      metaLeads,
      metaWithClickId,
      metaWithCampaign,
      metaEventsSent,
      sentByNameAgg,
    ] = await Promise.all([
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
      ]),
      Conversation.countDocuments(metaFilter),
      Conversation.countDocuments({ ...metaFilter, metaCtwaClid: present }),
      Conversation.countDocuments({ ...metaFilter, 'metaAdData.campaignId': present }),
      Conversation.countDocuments({ ...metaFilter, 'metaConversions.mqlQualifiedSentAt': { $exists: true } }),
      MetaEventLog.aggregate([
        {
          $match: {
            clientId,
            status: 'sent',
            ...(filter.lastMessageAt ? { sentAt: filter.lastMessageAt } : {}),
          },
        },
        { $group: { _id: '$eventName', count: { $sum: 1 } } },
      ]),
    ]);

    const eventsByName: Record<string, number> = { LeadSubmitted: 0, QualifiedLead: 0, Purchase: 0 };
    for (const row of sentByNameAgg) {
      if (row?._id && typeof row.count === 'number') eventsByName[String(row._id)] = row.count;
    }

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
      // How much of the Meta traffic can actually be attributed to an ad click
      attribution: {
        metaLeads,
        withClickId: metaWithClickId,
        withCampaign: metaWithCampaign,
        eventsSent: metaEventsSent,
        eventsByName,
        clickCaptureRate: metaLeads > 0 ? Math.round((metaWithClickId / metaLeads) * 1000) / 10 : null,
        campaignResolveRate: metaWithClickId > 0 ? Math.round((metaWithCampaign / metaWithClickId) * 1000) / 10 : null,
      },
      topLeads
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
