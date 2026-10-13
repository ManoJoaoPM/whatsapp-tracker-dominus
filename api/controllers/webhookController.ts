import { Request, Response } from 'express';
import crypto from 'crypto';
import Client from '../models/Client.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import ConnectionInvite from '../models/ConnectionInvite.js';
import OriginEvent from '../models/OriginEvent.js';
import MetaLeadLog from '../models/MetaLeadLog.js';
import { getMediaMessageModel } from '../config/mediaDb.js';
import { fetchMediaBase64, fetchSavedContactName } from '../services/evolutionService.js';
import { scheduleMqlScoring } from '../services/mqlAutoScore.js';
import { enqueueMetaLeadSubmitted } from '../services/metaEventQueue.js';
import {
  extractMetaCtwaClidFromCloudMessage,
  extractMetaCtwaClidFromEvolutionMessage,
  extractMetaExternalAdReply,
  extractMetaReferralFromCloudMessage,
  extractMetaSourceIdFromCloudMessage,
  extractMetaSourceIdFromEvolutionMessage,
} from '../services/originDetection.js';
import { buildMetaAdData, registerMetaClick } from '../services/attribution.js';

const safeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

let warnedMissingEvolutionToken = false;

const isEvolutionWebhookAuthorized = (req: Request): boolean => {
  const expected = String(process.env.EVOLUTION_WEBHOOK_TOKEN || '').trim();
  if (!expected) {
    if (!warnedMissingEvolutionToken) {
      warnedMissingEvolutionToken = true;
      console.warn('EVOLUTION_WEBHOOK_TOKEN is not set: the Evolution webhook is accepting unauthenticated requests');
    }
    return true;
  }
  const fromQuery = typeof req.query?.token === 'string' ? req.query.token : '';
  const fromHeader = typeof req.headers['x-webhook-token'] === 'string' ? req.headers['x-webhook-token'] : '';
  const provided = fromQuery || fromHeader;
  return Boolean(provided) && safeEqual(provided, expected);
};

export const handleEvolutionWebhook = async (req: Request, res: Response): Promise<void> => {
  if (!isEvolutionWebhookAuthorized(req)) {
    res.sendStatus(401);
    return;
  }

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

    const account = await WhatsAppAccount.findOne({ instanceId: instanceName });
    if (!account) {
      console.warn('Webhook received for unknown instance:', instanceName);
      return;
    }

    const client = await Client.findById(account.clientId);
    if (!client) return;

    const io = req.app.get('io');

    if (normalizedEvent === 'CONNECTION_UPDATE') {
      const oldStatus = account.status;
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
        account.status = newStatus as 'connected' | 'disconnected' | 'pending';
        if (newStatus === 'connected' && !account.connectedAt) {
          account.connectedAt = new Date();
        }
        await account.save();

        // A customer link that created this number is done once the number is connected
        if (newStatus === 'connected') {
          await ConnectionInvite.updateMany(
            { whatsappAccountId: account._id, status: { $in: ['pending', 'started'] } },
            { $set: { status: 'connected', connectedAt: new Date() }, $unset: { provisioningAt: 1 } },
          ).catch((err) => console.error('Could not update connection invite:', err?.message || err));
        }

        // Notify frontend
        if (io) {
          // const roomSize = io.sockets?.adapter?.rooms?.get?.(client.id)?.size || 0;
          // console.log('Emitting connection_update', {
          //   room: client.id,
          //   roomSize,
          //   status: newStatus,
          //   at: new Date().toISOString(),
          // });
          io.to(client.id).emit('connection_update', { whatsappAccountId: String(account._id), status: newStatus });
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
        let conversation = await Conversation.findOne({ clientId: client.id, whatsappAccountId: account.id, contactPhone });

        // Build preview text for lastMessageContent
        let previewContent = content;
        if (mediaType === 'image') previewContent = '📷 Foto';
        if (mediaType === 'audio') previewContent = '🎵 Áudio';
        if (mediaType === 'document') previewContent = '📄 Documento';

        const ctwaClid = extractMetaCtwaClidFromEvolutionMessage(msg?.message ?? msg);
        const sourceId = extractMetaSourceIdFromEvolutionMessage(msg?.message ?? msg);
        const externalAdReply = extractMetaExternalAdReply(msg?.message ?? msg);
        const isPotentialMetaLead = Boolean(ctwaClid || sourceId || externalAdReply);

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

          let metaAdData: any = undefined;

          if (ctwaClid || sourceId || externalAdReply) {
            origin = 'meta_ads';
            metaAdData = await buildMetaAdData({ clientId: client.id, sourceId, externalAdReply });
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
            whatsappAccountId: account.id,
            contactPhone,
            contactName: pushName,
            origin,
            originConfidence,
            metaCtwaClid: ctwaClid || undefined,
            metaLastClickAt: ctwaClid || sourceId ? new Date(msg.messageTimestamp * 1000) : undefined,
            metaClicks:
              ctwaClid || sourceId
                ? [
                    {
                      ctwaClid: ctwaClid || undefined,
                      sourceId: sourceId || undefined,
                      receivedAt: new Date(msg.messageTimestamp * 1000),
                      externalMessageId: msg?.key?.id ? String(msg.key.id) : undefined,
                    },
                  ]
                : [],
            metaAdData,
            funnelStage: funnelStage,
            funnelHistory: [{ stage: funnelStage, changedAt: new Date() }],
            lastMessageAt: new Date(msg.messageTimestamp * 1000),
            lastInboundMessageAt: isFromMe ? undefined : new Date(msg.messageTimestamp * 1000),
            lastOutboundMessageAt: isFromMe ? new Date(msg.messageTimestamp * 1000) : undefined,
            lastMessageContent: previewContent,
            unreadCount: isFromMe ? 0 : 1,
            messageCount: 1,
            inboundMessageCount: isFromMe ? 0 : 1
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
            conversation.inboundMessageCount = (conversation.inboundMessageCount || 0) + 1;
            // Auto advance stage if it's first_contact
            if (conversation.funnelStage === 'first_contact') {
              conversation.funnelStage = 'replied';
              conversation.funnelHistory.push({ stage: 'replied', changedAt: new Date() });
            }

            // A returning contact may have clicked a new ad: the latest click wins
            await registerMetaClick({
              conversation,
              clientId: client.id,
              ctwaClid,
              sourceId,
              externalAdReply,
              externalMessageId: msg?.key?.id ? String(msg.key.id) : undefined,
              at: msgDate,
            });
          }
          await conversation.save();
        }

        if (!isFromMe && (isPotentialMetaLead || conversation.origin === 'meta_ads')) {
          void MetaLeadLog.create({
            clientId: client.id,
            whatsappAccountId: account.id,
            conversationId: conversation._id,
            contactPhone,
            externalMessageId: msg?.key?.id ? String(msg.key.id) : undefined,
            isFromMe: Boolean(isFromMe),
            ctwaClid: ctwaClid || undefined,
            sourceId: sourceId || undefined,
            rawPayload: msg,
          }).catch((err: any) => {
            console.error('Error saving MetaLeadLog:', err?.message || err);
          });
        }

        // Save message
        const messagePayload = {
          conversationId: conversation.id,
          clientId: client.id,
          whatsappAccountId: account.id,
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

        // Early signal for Meta: the lead answered. Cheap check first, the queue re-validates everything.
        if (
          !isFromMe &&
          conversation.origin === 'meta_ads' &&
          !conversation.metaConversions?.leadSubmittedQueuedAt
        ) {
          void enqueueMetaLeadSubmitted({ conversationId: conversation.id, clientId: client.id }).catch((err) => {
            console.error('[meta-events] could not enqueue LeadSubmitted', err?.message || err);
          });
        }

        void scheduleMqlScoring({ conversationId: conversation.id, clientId: client.id });

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

const timingSafeEqualHex = (a: string, b: string) => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

export const verifyWhatsAppCloudWebhook = (req: Request, res: Response): void => {
  const mode = typeof req.query?.['hub.mode'] === 'string' ? req.query['hub.mode'] : '';
  const token = typeof req.query?.['hub.verify_token'] === 'string' ? req.query['hub.verify_token'] : '';
  const challenge = typeof req.query?.['hub.challenge'] === 'string' ? req.query['hub.challenge'] : '';

  if (mode === 'subscribe' && token && token === process.env.WHATSAPP_CLOUD_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
};

export const handleWhatsAppCloudWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const appSecret = String(process.env.WHATSAPP_CLOUD_APP_SECRET || '').trim();
    const signature = String(req.headers['x-hub-signature-256'] || '');

    // Fail closed: without the app secret we cannot prove the request came from Meta
    if (!appSecret) {
      console.error('WHATSAPP_CLOUD_APP_SECRET is not set: rejecting WhatsApp Cloud webhook');
      res.sendStatus(503);
      return;
    }

    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody || !signature.startsWith('sha256=')) {
      res.sendStatus(401);
      return;
    }
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    if (!timingSafeEqualHex(signature, expected)) {
      res.sendStatus(401);
      return;
    }

    res.status(200).json({ success: true });

    void (async () => {
      const body = req.body;
      const entries = Array.isArray(body?.entry) ? body.entry : [];

      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          if (messages.length === 0) continue;

          const phoneNumberId = value?.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : '';
          if (!phoneNumberId) continue;

          const account = await WhatsAppAccount.findOne({ cloudPhoneNumberId: phoneNumberId });
          if (!account) continue;

          if (account.status !== 'connected') {
            account.status = 'connected';
            if (!account.connectedAt) account.connectedAt = new Date();
            await account.save();
          }

          const client = await Client.findById(account.clientId);
          if (!client) continue;

          const io = req.app.get('io');

          const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
          const nameByWaId = new Map<string, string>();
          for (const c of contacts) {
            const waId = typeof c?.wa_id === 'string' ? c.wa_id : '';
            const name = typeof c?.profile?.name === 'string' ? c.profile.name : '';
            if (waId) nameByWaId.set(waId, name);
          }

          for (const msg of messages) {
            const contactPhone = typeof msg?.from === 'string' ? msg.from : '';
            if (!contactPhone) continue;

            let content = '';
            let mediaType: 'text' | 'image' | 'audio' | 'document' | 'null' = 'text';
            let mediaUrl = '';

            const t = typeof msg?.type === 'string' ? msg.type : '';
            if (t === 'text') {
              content = typeof msg?.text?.body === 'string' ? msg.text.body : '';
              mediaType = 'text';
            } else if (t === 'image') {
              content = typeof msg?.image?.caption === 'string' ? msg.image.caption : 'Imagem';
              mediaType = 'image';
            } else if (t === 'audio' || t === 'voice') {
              content = 'Áudio';
              mediaType = 'audio';
            } else if (t === 'document') {
              content = typeof msg?.document?.filename === 'string' ? msg.document.filename : 'Documento';
              mediaType = 'document';
            } else {
              content = 'Mensagem não suportada';
              mediaType = 'null';
            }

            let previewContent = content;
            if (mediaType === 'image') previewContent = '📷 Foto';
            if (mediaType === 'audio') previewContent = '🎵 Áudio';
            if (mediaType === 'document') previewContent = '📄 Documento';

            const pushName = nameByWaId.get(contactPhone) || '';
            const timestampSeconds = Number(msg?.timestamp);
            const msgDate = Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1000) : new Date();

            const ctwaClid = extractMetaCtwaClidFromCloudMessage(msg);
            const sourceId = extractMetaSourceIdFromCloudMessage(msg);
            const referral = extractMetaReferralFromCloudMessage(msg);
            const isPotentialMetaLead = Boolean(ctwaClid || sourceId);
            const externalMessageId = typeof msg?.id === 'string' ? msg.id : undefined;

            let conversation = await Conversation.findOne({
              clientId: client.id,
              whatsappAccountId: account.id,
              contactPhone,
            });

            if (!conversation) {
              let origin: any = 'unknown';
              let originConfidence: any = 'auto';
              const funnelStage: any = 'first_contact';

              let metaAdData: any = undefined;

              if (ctwaClid || sourceId) {
                origin = 'meta_ads';
                metaAdData = await buildMetaAdData({ clientId: client.id, sourceId, externalAdReply: referral });
              }

              const originEvent = await OriginEvent.findOne({ clientId: client.id, contactPhone }).sort({ capturedAt: -1 });
              if (origin === 'unknown' && originEvent) {
                if (originEvent.utmSource?.toLowerCase().includes('facebook') || originEvent.utmSource?.toLowerCase().includes('meta')) {
                  origin = 'meta_ads';
                } else if (originEvent.utmSource?.toLowerCase().includes('google')) {
                  origin = 'google_ads';
                } else {
                  origin = 'organic';
                }
              }

              conversation = await Conversation.create({
                clientId: client.id,
                whatsappAccountId: account.id,
                contactPhone,
                contactName: pushName || undefined,
                origin,
                originConfidence,
                metaCtwaClid: ctwaClid || undefined,
                metaLastClickAt: ctwaClid || sourceId ? msgDate : undefined,
                metaClicks:
                  ctwaClid || sourceId
                    ? [
                        {
                          ctwaClid: ctwaClid || undefined,
                          sourceId: sourceId || undefined,
                          receivedAt: msgDate,
                          externalMessageId,
                        },
                      ]
                    : [],
                metaAdData,
                funnelStage: funnelStage,
                funnelHistory: [{ stage: funnelStage, changedAt: new Date() }],
                lastMessageAt: msgDate,
                lastInboundMessageAt: msgDate,
                lastMessageContent: previewContent,
                unreadCount: 1,
                messageCount: 1,
                inboundMessageCount: 1,
              });
            } else {
              conversation.lastMessageAt = msgDate;
              conversation.lastMessageContent = previewContent;
              conversation.messageCount = Number(conversation.messageCount || 0) + 1;
              if (!conversation.lastInboundMessageAt || msgDate > conversation.lastInboundMessageAt) {
                conversation.lastInboundMessageAt = msgDate;
              }

              if (!conversation.contactName || conversation.contactName === conversation.contactPhone) {
                if (pushName) conversation.contactName = pushName;
              }

              conversation.unreadCount = Number(conversation.unreadCount || 0) + 1;
              conversation.inboundMessageCount = (conversation.inboundMessageCount || 0) + 1;
              if (conversation.funnelStage === 'first_contact') {
                conversation.funnelStage = 'replied';
                conversation.funnelHistory.push({ stage: 'replied', changedAt: new Date() });
              }

              // A returning contact may have clicked a new ad: the latest click wins
              await registerMetaClick({
                conversation,
                clientId: client.id,
                ctwaClid,
                sourceId,
                externalAdReply: referral,
                externalMessageId,
                at: msgDate,
              });
              await conversation.save();
            }

            if (isPotentialMetaLead || conversation.origin === 'meta_ads') {
              void MetaLeadLog.create({
                clientId: client.id,
                whatsappAccountId: account.id,
                conversationId: conversation._id,
                contactPhone,
                externalMessageId: typeof msg?.id === 'string' ? msg.id : undefined,
                isFromMe: false,
                ctwaClid: ctwaClid || undefined,
                sourceId: sourceId || undefined,
                rawPayload: msg,
              }).catch((err: any) => {
                console.error('Error saving MetaLeadLog:', err?.message || err);
              });
            }

            const messagePayload = {
              conversationId: conversation.id,
              clientId: client.id,
              whatsappAccountId: account.id,
              direction: 'inbound' as const,
              content,
              mediaType,
              mediaUrl: mediaUrl || undefined,
              timestamp: msgDate,
              externalMessageId: typeof msg?.id === 'string' ? msg.id : undefined,
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

            // Early signal for Meta: the lead answered
            if (conversation.origin === 'meta_ads' && !conversation.metaConversions?.leadSubmittedQueuedAt) {
              void enqueueMetaLeadSubmitted({ conversationId: conversation.id, clientId: client.id }).catch((err) => {
                console.error('[meta-events] could not enqueue LeadSubmitted', err?.message || err);
              });
            }

            void scheduleMqlScoring({ conversationId: conversation.id, clientId: client.id });

            if (io) {
              const emittedMessage = shouldStoreMediaInSecondary
                ? { ...(newMessage.toObject?.() ?? newMessage), mediaUrl: messagePayload.mediaUrl }
                : newMessage;
              io.to(client.id).emit('new_message', {
                conversation,
                message: emittedMessage,
              });
            }
          }
        }
      }
    })().catch((err) => {
      console.error('WhatsApp Cloud webhook async error:', err);
    });
  } catch (error) {
    console.error('WhatsApp Cloud webhook error:', error);
    if (!res.headersSent) {
      res.status(200).json({ success: false });
    }
  }
};
