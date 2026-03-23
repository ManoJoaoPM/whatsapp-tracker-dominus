import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { sendMessage as evolutionSendMessage, fetchChatHistory } from '../services/evolutionService.js';
import Client from '../models/Client.js';

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
                  if (msg.message.imageMessage.base64) {
                    mediaUrl = `data:image/jpeg;base64,${msg.message.imageMessage.base64}`;
                  }
                } else if (msg.message?.audioMessage) {
                  content = 'Áudio';
                  mediaType = 'audio';
                  if (msg.message.audioMessage.base64) {
                    mediaUrl = `data:audio/ogg;base64,${msg.message.audioMessage.base64}`;
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

                await Message.create({
                  conversationId: conversation._id,
                  clientId: client._id,
                  direction: isFromMe ? 'outbound' : 'inbound',
                  content,
                  mediaType,
                  mediaUrl: mediaUrl || undefined,
                  timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
                  externalMessageId
                });
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

    const messages = await Message.find({ conversationId: id }).sort({ timestamp: 1 });
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
    await conversation.save();

    res.json(newMessage);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const updateFunnelStage = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { stage } = req.body;

    const conversation = await Conversation.findOne({ _id: id, clientId: req.currentClient.id });
    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    conversation.funnelStage = stage;
    conversation.funnelHistory.push({
      stage,
      changedAt: new Date(),
      changedBy: req.user.name
    });

    await conversation.save();
    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};