import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { sendMessage as evolutionSendMessage, fetchChatHistory, fetchMediaBase64 } from '../services/evolutionService.js';
import { tryAutoScoreMql } from '../services/mqlAutoScore.js';
import { getMediaMessageModel } from '../config/mediaDb.js';

const FUNNEL_STAGES = [
  'first_contact',
  'replied',
  'qualified',
  'proposal',
  'scheduled',
  'closed',
  'lost',
] as const;

type FunnelStage = (typeof FUNNEL_STAGES)[number];

const toCard = (conv: any) => ({
  id: String(conv._id),
  clientId: String(conv.clientId),
  contactName: conv.contactName || undefined,
  contactPhone: conv.contactPhone,
  origin: conv.origin,
  funnelStage: conv.funnelStage,
  lastMessageAt: new Date(conv.lastMessageAt).toISOString(),
  lastMessagePreview: conv.lastMessageContent || undefined,
  unreadCount: conv.unreadCount || 0,
});

const isFunnelStage = (value: any): value is FunnelStage => {
  return FUNNEL_STAGES.includes(value);
};

export const getConversations = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const filter: any = { clientId: req.currentClient.id };
    
    // Support filtering by origin or stage
    if (req.query.origin) {
      filter.origin = req.query.origin;
    }
    if (req.query.stage) {
      filter.funnelStage = req.query.stage;
    }

    const conversations = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(20);
    res.json(conversations);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getConversationById = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id }).lean();
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getKanban = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const baseFilter: any = { clientId: req.currentClient.id };

    const origin = typeof req.query.origin === 'string' ? req.query.origin : '';
    const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';

    const perStageRaw = typeof req.query.perStage === 'string' ? Number(req.query.perStage) : 50;
    const perStage = Number.isFinite(perStageRaw) ? Math.max(1, Math.min(200, perStageRaw)) : 50;

    if (origin) baseFilter.origin = origin;
    if (stage) baseFilter.funnelStage = stage;

    if (from || to) {
      baseFilter.lastMessageAt = {};
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) baseFilter.lastMessageAt.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) baseFilter.lastMessageAt.$lte = d;
      }
      if (Object.keys(baseFilter.lastMessageAt).length === 0) {
        delete baseFilter.lastMessageAt;
      }
    }

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      baseFilter.$or = [
        { contactName: rx },
        { contactPhone: rx },
        { lastMessageContent: rx },
      ];
    }

    const countsAgg = await Conversation.aggregate([
      { $match: baseFilter },
      { $group: { _id: '$funnelStage', count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
    for (const row of countsAgg) {
      if (row?._id && typeof row.count === 'number') {
        counts[String(row._id)] = row.count;
      }
    }

    const columnsEntries = await Promise.all(
      FUNNEL_STAGES.map(async (s) => {
        const stageFilter = { ...baseFilter, funnelStage: s };
        const convs = await Conversation.find(stageFilter)
          .sort({ lastMessageAt: -1 })
          .limit(perStage)
          .select('_id clientId contactPhone contactName origin funnelStage lastMessageAt lastMessageContent unreadCount')
          .lean();
        return [s, convs.map(toCard)] as const;
      })
    );

    const columns = Object.fromEntries(columnsEntries);

    res.json({
      stages: FUNNEL_STAGES,
      columns,
      counts,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getMessages = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id });
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    // Reset unread count
    if (conversation.unreadCount > 0) {
      conversation.unreadCount = 0;
      await conversation.save();
    }

    // Sync history if not synced yet
    if (!conversation.historySynced) {
      const client = req.currentClient;
      if (client?.whatsappInstance?.instanceId && client.whatsappInstance.status === 'connected') {
        try {
          const history = await fetchChatHistory(client.whatsappInstance.instanceId, conversation.contactPhone);
          
          if (history && Array.isArray(history)) {
            let latestInboundDate = conversation.lastInboundMessageAt ? new Date(conversation.lastInboundMessageAt) : null;
            let latestOutboundDate = conversation.lastOutboundMessageAt ? new Date(conversation.lastOutboundMessageAt) : null;

            // Process and save messages that don't exist yet
            for (const msg of history) {
              // Ignore broadcast or group messages
              if (msg.key?.remoteJid === 'status@broadcast' || msg.key?.remoteJid?.includes('@g.us')) {
                continue;
              }

              const externalMessageId = msg.key?.id;
              if (!externalMessageId) continue;

              const isFromMe = msg.key?.fromMe;
              const msgTimestamp = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000);

              if (isFromMe) {
                if (!latestOutboundDate || msgTimestamp > latestOutboundDate) {
                  latestOutboundDate = msgTimestamp;
                }
              } else {
                if (!latestInboundDate || msgTimestamp > latestInboundDate) {
                  latestInboundDate = msgTimestamp;
                }
              }

              const existingMsg = await Message.findOne({ externalMessageId, conversationId: conversation._id });
              if (!existingMsg) {
                
                let content = '';
                let mediaType = 'text';
                let mediaUrl = '';

                if (msg.message?.conversation) {
                  content = msg.message.conversation;
                } else if (msg.message?.extendedTextMessage?.text) {
                  content = msg.message.extendedTextMessage.text;
                } else if (msg.message?.imageMessage) {
                  content = msg.message.imageMessage.caption || 'Imagem';
                  mediaType = 'image';
                  let base64Data = msg.message.imageMessage.base64;
                  if (!base64Data && externalMessageId) {
                    base64Data = await fetchMediaBase64(client.whatsappInstance.instanceId, externalMessageId);
                  }
                  if (base64Data) {
                    mediaUrl = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
                  }
                } else if (msg.message?.audioMessage) {
                  content = 'Áudio';
                  mediaType = 'audio';
                  let base64Data = msg.message.audioMessage.base64;
                  if (!base64Data && externalMessageId) {
                    base64Data = await fetchMediaBase64(client.whatsappInstance.instanceId, externalMessageId);
                  }
                  if (base64Data) {
                    mediaUrl = base64Data.startsWith('data:') ? base64Data : `data:audio/ogg;base64,${base64Data}`;
                  }
                } else if (msg.message?.documentMessage) {
                  content = msg.message.documentMessage.fileName || 'Documento';
                  mediaType = 'document';
                  if (msg.message.documentMessage.base64) {
                    const mimeType = msg.message.documentMessage.mimetype || 'application/octet-stream';
                    mediaUrl = `data:${mimeType};base64,${msg.message.documentMessage.base64}`;
                  }
                } else if (msg.message?.base64) {
                  mediaUrl = msg.message.base64.startsWith('data:') ? msg.message.base64 : `data:application/octet-stream;base64,${msg.message.base64}`;
                  if (!mediaType || mediaType === 'text') mediaType = 'document';
                } else {
                  content = 'Mensagem não suportada';
                  mediaType = 'null';
                }

                const messagePayload = {
                  conversationId: conversation._id,
                  clientId: client._id,
                  direction: isFromMe ? 'outbound' : 'inbound',
                  content,
                  mediaType,
                  mediaUrl: mediaUrl || undefined,
                  timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
                  externalMessageId
                };

                const shouldStoreMediaInSecondary = mediaType === 'image' || mediaType === 'audio';
                const primaryPayload = shouldStoreMediaInSecondary
                  ? { ...messagePayload, mediaUrl: undefined }
                  : messagePayload;

                await Message.create(primaryPayload);

                if (shouldStoreMediaInSecondary) {
                  const MediaMessage = await getMediaMessageModel();
                  if (MediaMessage) {
                    void MediaMessage.create(messagePayload).catch(() => {});
                  }
                }
              }
            }

            if (latestInboundDate) conversation.lastInboundMessageAt = latestInboundDate;
            if (latestOutboundDate) conversation.lastOutboundMessageAt = latestOutboundDate;
          }

          conversation.historySynced = true;
          await conversation.save();
        } catch (error) {
          console.error('Failed to sync history for conversation', conversation._id, error);
        }
      }
    }

    if (!conversation.messageCount) {
      const count = await Message.countDocuments({ conversationId: id });
      conversation.messageCount = count;
      if (!conversation.mqlLastScoredMessageCount) conversation.mqlLastScoredMessageCount = 0;
      await conversation.save();
    }

    const io = req.app.get('io');
    setTimeout(() => {
      void tryAutoScoreMql({ conversationId: conversation.id, clientId: req.currentClient.id, io });
    }, 0);

    const messages: any[] = await Message.find({ conversationId: id }).sort({ timestamp: 1 }).lean();

    for (const m of messages) {
      if (m?.mediaType === 'image' || m?.mediaType === 'audio') {
        m.mediaUrl = undefined;
      }
    }

    const mediaExternalIds = messages
      .filter(
        (m) =>
          (m?.mediaType === 'image' || m?.mediaType === 'audio') &&
          typeof m?.externalMessageId === 'string' &&
          m.externalMessageId,
      )
      .map((m) => m.externalMessageId);

    if (mediaExternalIds.length > 0) {
      const MediaMessage = await getMediaMessageModel();
      if (MediaMessage) {
        const mediaDocs: Array<{ externalMessageId?: string; mediaUrl?: string }> = await MediaMessage.find({
          conversationId: id,
          externalMessageId: { $in: mediaExternalIds },
        })
          .select('externalMessageId mediaUrl')
          .lean();

        const mediaUrlByExternalId = new Map(
          mediaDocs
            .filter((d) => typeof d?.externalMessageId === 'string' && d.externalMessageId)
            .map((d) => [String(d.externalMessageId), d.mediaUrl] as const),
        );

        for (const m of messages) {
          if (
            (m?.mediaType === 'image' || m?.mediaType === 'audio') &&
            !m?.mediaUrl &&
            typeof m?.externalMessageId === 'string' &&
            m.externalMessageId
          ) {
            const u = mediaUrlByExternalId.get(m.externalMessageId);
            if (u) m.mediaUrl = u;
          }
        }
      }
    }

    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const sendMessage = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id });
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const client = req.currentClient;
    if (!client?.whatsappInstance?.instanceId || client.whatsappInstance.status !== 'connected') {
      res.status(400).json({ message: 'WhatsApp not connected' });
      return;
    }

    // Send via Evolution API
    const evolutionResponse = await evolutionSendMessage(
      client.whatsappInstance.instanceId,
      conversation.contactPhone,
      text
    );

    // Save to DB
    const newMessage = await Message.create({
      conversationId: conversation.id,
      clientId: client.id,
      direction: 'outbound',
      content: text,
      mediaType: 'text',
      timestamp: new Date(),
      externalMessageId: evolutionResponse?.key?.id || undefined
    });

    // Update conversation
    conversation.lastMessageAt = new Date();
    conversation.lastOutboundMessageAt = new Date();
    conversation.messageCount = Number(conversation.messageCount || 0) + 1;
    await conversation.save();

    const io = req.app.get('io');
    setTimeout(() => {
      void tryAutoScoreMql({ conversationId: conversation.id, clientId: req.currentClient.id, io });
    }, 0);

    res.json(newMessage);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateFunnelStage = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    if (!isFunnelStage(stage)) {
      res.status(400).json({ message: 'Invalid funnel stage' });
      return;
    }

    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id });
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    conversation.funnelStage = stage;
    conversation.funnelHistory.push({
      stage,
      changedAt: new Date(),
      changedBy: req.user?.name || req.user?.email || 'user'
    });

    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      io.to(String(req.currentClient.id)).emit('conversation_updated', { conversation: toCard(conversation) });
    }
    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
