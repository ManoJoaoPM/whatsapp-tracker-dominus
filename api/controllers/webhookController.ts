import { Request, Response } from 'express';
import Client from '../models/Client.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import OriginEvent from '../models/OriginEvent.js';
import { getMediaMessageModel } from '../config/mediaDb.js';
import { fetchMediaBase64, fetchSavedContactName } from '../services/evolutionService.js';
import { tryAutoScoreMql } from '../services/mqlAutoScore.js';
import { extractMetaCtwaClidFromEvolutionMessage } from '../services/originDetection.js';

export const handleEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const { event, data, instance } = req.body;

    const normalizedEvent = String(event || '')
      .trim()
      .toUpperCase()
      .replace(/\./g, '_');

    const instanceName =
      instance ||
      data?.instance ||
      data?.instanceName ||
      data?.instanceId ||
      data?.instance_id ||
      null;

    // Only log webhook received if it's not a noisy CONNECTION_UPDATE, 
    // or log it minimally if needed.
    if (normalizedEvent !== 'CONNECTION_UPDATE') {
      console.log('Evolution webhook received', {
        event,
        normalizedEvent,
        instance: instanceName,
        hasData: Boolean(data),
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : undefined,
        at: new Date().toISOString(),
      });
    }

    // Acknowledge receipt
    res.status(200).json({ success: true });

    if (!instanceName) return;

    // Find the client by instanceId
    const client = await Client.findOne({ 'whatsappInstance.instanceId': instanceName });
    if (!client) {
      console.warn('Webhook received for unknown instance:', instanceName);
      return;
    }

    const io = req.app.get('io');

    if (normalizedEvent === 'CONNECTION_UPDATE') {
      const oldStatus = client.whatsappInstance?.status;
      let newStatus = oldStatus;

      // Tratar estados de conexão
      if (data.state === 'open') {
        newStatus = 'connected';
      } else if (data.state === 'close' || data.state === 'connecting') {
        newStatus = data.state === 'connecting' ? 'pending' : 'disconnected';
      } else if (data.statusReason === '401' || data.statusReason === '403') {
        newStatus = 'disconnected';
      }

      // Só salva e emite se o status realmente mudou
      if (newStatus && newStatus !== oldStatus) {
        client.whatsappInstance!.status = newStatus as 'connected' | 'disconnected' | 'pending';
        await client.save();
        
        // Notify frontend
        if (io) {
          // const roomSize = io.sockets?.adapter?.rooms?.get?.(client.id)?.size || 0;
          // console.log('Emitting connection_update', {
          //   room: client.id,
          //   roomSize,
          //   status: newStatus,
          //   at: new Date().toISOString(),
          // });
          io.to(client.id).emit('connection_update', { status: newStatus });
        }
      }
      return;
    }

    if (normalizedEvent === 'MESSAGES_UPSERT') {
      const messages = Array.isArray(data?.messages)
        ? data.messages
        : data?.key
          ? [data]
          : [];

      console.log('MESSAGES_UPSERT payload', {
        instance: instanceName,
        messagesCount: Array.isArray(messages) ? messages.length : 0,
        at: new Date().toISOString(),
      });
      
      for (const msg of messages) {
        // Ignore status updates, protocol messages, or group messages
        if (msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.includes('@g.us')) {
          continue;
        }

        const contactPhone = msg.key.remoteJid.split('@')[0];
        const isFromMe = msg.key.fromMe;
        // Se a mensagem for minha, não devo usar o meu próprio nome como nome do contato
        let pushName = isFromMe ? '' : (msg.pushName || '');

        // Extract content
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
          
          let base64Data = msg.base64 || msg.message?.base64 || msg.message.imageMessage?.base64;
          if (!base64Data && msg.key?.id) {
            // Fetch media from Evolution API if not in webhook payload
            base64Data = await fetchMediaBase64(instanceName, msg.key.id);
          }

          if (base64Data) {
            mediaUrl = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
          }
        } else if (msg.message?.audioMessage) {
          content = 'Áudio';
          mediaType = 'audio';
          
          let base64Data = msg.base64 || msg.message?.base64 || msg.message.audioMessage?.base64;
          if (!base64Data && msg.key?.id) {
             // Fetch media from Evolution API if not in webhook payload
             base64Data = await fetchMediaBase64(instanceName, msg.key.id);
          }

          if (base64Data) {
            // O WhatsApp usa ogg/opus para áudio
            mediaUrl = base64Data.startsWith('data:') ? base64Data : `data:audio/ogg;base64,${base64Data}`;
          }
        } else if (msg.message?.documentMessage) {
          content = msg.message.documentMessage.fileName || 'Documento';
          mediaType = 'document';
          
          let base64Data = msg.base64 || msg.message?.base64 || msg.message.documentMessage?.base64;
          if (!base64Data && msg.key?.id) {
            base64Data = await fetchMediaBase64(instanceName, msg.key.id);
          }

          if (base64Data) {
            const mimeType = msg.message.documentMessage.mimetype || 'application/octet-stream';
            mediaUrl = base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${base64Data}`;
          }
        } else if (msg.message?.base64) {
           // Fallback general para arquivos recebidos em base64 na raiz da mensagem
           mediaUrl = msg.message.base64.startsWith('data:') ? msg.message.base64 : `data:application/octet-stream;base64,${msg.message.base64}`;
           if (!mediaType || mediaType === 'text') mediaType = 'document';
        } else {
          content = 'Mensagem não suportada';
          mediaType = 'null';
        }

        // Find or create conversation
        let conversation = await Conversation.findOne({ clientId: client.id, contactPhone });

        // Build preview text for lastMessageContent
        let previewContent = content;
        if (mediaType === 'image') previewContent = '📷 Foto';
        if (mediaType === 'audio') previewContent = '🎵 Áudio';
        if (mediaType === 'document') previewContent = '📄 Documento';

        if (!conversation) {
          // Se for uma conversa nova e não temos o nome, tenta buscar na agenda da Evolution API
          if (!pushName) {
             const fetchedName = await fetchSavedContactName(instanceName, contactPhone);
             if (fetchedName) {
               pushName = fetchedName;
             }
          }

          // Identify origin logic (Simplified MVP version)
          let origin = 'unknown';
          let originConfidence = 'auto';
          let funnelStage = 'first_contact';

          const msgTextLower = content.toLowerCase();

          const ctwaClid = extractMetaCtwaClidFromEvolutionMessage(msg?.message ?? msg);
          if (ctwaClid) {
            origin = 'meta_ads';
          }

          // 1. Try to find matching origin event (e.g. from landing page)
          const originEvent = await OriginEvent.findOne({ clientId: client.id, contactPhone }).sort({ capturedAt: -1 });
          if (origin === 'unknown' && originEvent) {
            if (originEvent.utmSource?.toLowerCase().includes('facebook') || originEvent.utmSource?.toLowerCase().includes('meta')) {
              origin = 'meta_ads';
            } else if (originEvent.utmSource?.toLowerCase().includes('google')) {
              origin = 'google_ads';
            } else {
              origin = 'organic';
            }
          } else if (!isFromMe) {
            // 2. Fallback to message content keywords only if inbound
            if (msgTextLower.includes('meta') || msgTextLower.includes('facebook') || msgTextLower.includes('instagram') || msgTextLower.includes('fb')) {
              origin = 'meta_ads';
            } else if (msgTextLower.includes('google') || msgTextLower.includes('youtube') || msgTextLower.includes('pesquisa')) {
              origin = 'google_ads';
            }
          }

          conversation = await Conversation.create({
            clientId: client.id,
            contactPhone,
            contactName: pushName,
            origin,
            originConfidence,
            funnelStage: funnelStage,
            funnelHistory: [{ stage: funnelStage, changedAt: new Date() }],
            lastMessageAt: new Date(msg.messageTimestamp * 1000),
            lastInboundMessageAt: isFromMe ? undefined : new Date(msg.messageTimestamp * 1000),
            lastOutboundMessageAt: isFromMe ? new Date(msg.messageTimestamp * 1000) : undefined,
            lastMessageContent: previewContent,
            unreadCount: isFromMe ? 0 : 1,
            messageCount: 1
          });
        } else {
          // Update conversation
          const msgDate = new Date(msg.messageTimestamp * 1000);
          conversation.lastMessageAt = msgDate;
          conversation.lastMessageContent = previewContent;
          conversation.messageCount = Number(conversation.messageCount || 0) + 1;
          
          if (isFromMe) {
            // Se for mensagem enviada por nós (empresa)
            // Atualiza apenas se for mais recente que a data atual
            if (!conversation.lastOutboundMessageAt || msgDate > conversation.lastOutboundMessageAt) {
              conversation.lastOutboundMessageAt = msgDate;
            }
          } else {
            // Se for mensagem recebida (lead)
            if (!conversation.lastInboundMessageAt || msgDate > conversation.lastInboundMessageAt) {
              conversation.lastInboundMessageAt = msgDate;
            }
          }

          // Update name if we didn't have one and now we received one
          if (!conversation.contactName || conversation.contactName === conversation.contactPhone) {
            if (pushName) {
              conversation.contactName = pushName;
            }
          }

          if (!isFromMe) {
            conversation.unreadCount += 1;
            // Auto advance stage if it's first_contact
            if (conversation.funnelStage === 'first_contact') {
              conversation.funnelStage = 'replied';
              conversation.funnelHistory.push({ stage: 'replied', changedAt: new Date() });
            }
          }
          await conversation.save();
        }

        // Save message
        const messagePayload = {
          conversationId: conversation.id,
          clientId: client.id,
          direction: isFromMe ? 'outbound' : 'inbound',
          content,
          mediaType,
          mediaUrl: mediaUrl || undefined,
          timestamp: new Date(msg.messageTimestamp * 1000),
          externalMessageId: msg.key.id
        };

        const shouldStoreMediaInSecondary = mediaType === 'image' || mediaType === 'audio';
        const primaryPayload = shouldStoreMediaInSecondary
          ? { ...messagePayload, mediaUrl: undefined }
          : messagePayload;

        const newMessage = await Message.create(primaryPayload);

        if (shouldStoreMediaInSecondary) {
          const MediaMessage = await getMediaMessageModel();
          if (MediaMessage) {
            void MediaMessage.create(messagePayload).catch((err: any) => {
              console.error('Media MongoDB save error:', err?.message || err);
            });
          }
        }

        setTimeout(() => {
          void tryAutoScoreMql({ conversationId: conversation.id, clientId: client.id, io });
        }, 0);

        // Notify frontend via WebSocket
        if (io) {
          const emittedMessage = shouldStoreMediaInSecondary
            ? { ...(newMessage.toObject?.() ?? newMessage), mediaUrl: messagePayload.mediaUrl }
            : newMessage;
          const roomSize = io.sockets?.adapter?.rooms?.get?.(client.id)?.size || 0;
          console.log('Emitting new_message', {
            room: client.id,
            roomSize,
            conversationId: conversation.id,
            direction: newMessage.direction,
            at: new Date().toISOString(),
          });
          io.to(client.id).emit('new_message', {
            conversation,
            message: emittedMessage
          });
        }
      }
    }

  } catch (error) {
    console.error('Webhook error:', error);
    // Even on error, we should return 200 so Evolution doesn't retry infinitely
    if (!res.headersSent) {
      res.status(200).json({ success: false });
    }
  }
};
