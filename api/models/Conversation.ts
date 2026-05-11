import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  clientId: Types.ObjectId;
  whatsappAccountId: Types.ObjectId;
  contactPhone: string;
  contactName?: string;
  origin: 'meta_ads' | 'google_ads' | 'organic' | 'unknown';
  originConfidence: 'auto' | 'manual';
  metaCtwaClid?: string;
  metaAdData?: {
    sourceId?: string;
    campaignId?: string;
    campaignName?: string;
    adsetId?: string;
    adsetName?: string;
    adId?: string;
    adName?: string;
    adTitle?: string;
    adBody?: string;
    mediaType?: string;
    thumbnailUrl?: string;
    mediaUrl?: string;
  };
  funnelStage: 'first_contact' | 'replied' | 'qualified' | 'proposal' | 'scheduled' | 'closed' | 'lost';
  funnelHistory: Array<{
    stage: string;
    changedAt: Date;
    changedBy?: string;
  }>;
  lastMessageAt: Date;
  lastInboundMessageAt?: Date;
  lastOutboundMessageAt?: Date;
  lastMessageContent?: string;
  unreadCount: number;
  historySynced?: boolean;
  mqlScore?: number;
  mqlLevel?: 'cold' | 'warm' | 'hot';
  mqlSummary?: string;
  mqlSignals?: string[];
  mqlUpdatedAt?: Date;
  mqlModel?: string;
  mqlRulesHash?: string;
  messageCount?: number;
  mqlLastScoredMessageCount?: number;
  mqlScoring?: boolean;
  inboundMessageCount?: number;
  metaConversions?: {
    mqlQualifiedSending?: boolean;
    mqlQualifiedEventId?: string;
    mqlQualifiedAttemptedAt?: Date;
    mqlQualifiedSentAt?: Date;
    mqlQualifiedLastError?: string;
    mqlQualifiedLastStatus?: number;
  };
  createdAt: Date;
}

const ConversationSchema = new Schema<IConversation>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount', required: true },
  contactPhone: { type: String, required: true },
  contactName: { type: String },
  origin: { type: String, enum: ['meta_ads', 'google_ads', 'organic', 'unknown'], default: 'unknown' },
  originConfidence: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  metaCtwaClid: { type: String },
  metaAdData: {
    sourceId: { type: String },
    campaignId: { type: String },
    campaignName: { type: String },
    adsetId: { type: String },
    adsetName: { type: String },
    adId: { type: String },
    adName: { type: String },
    adTitle: { type: String },
    adBody: { type: String },
    mediaType: { type: String },
    thumbnailUrl: { type: String },
    mediaUrl: { type: String },
  },
  funnelStage: { 
    type: String, 
    enum: ['first_contact', 'replied', 'qualified', 'proposal', 'scheduled', 'closed', 'lost'],
    default: 'first_contact'
  },
  funnelHistory: [{
    stage: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String }
  }],
  lastMessageAt: { type: Date, default: Date.now },
  lastInboundMessageAt: { type: Date },
  lastOutboundMessageAt: { type: Date },
  lastMessageContent: { type: String },
  unreadCount: { type: Number, default: 0 },
  historySynced: { type: Boolean, default: false },
  mqlScore: { type: Number },
  mqlLevel: { type: String, enum: ['cold', 'warm', 'hot'] },
  mqlSummary: { type: String },
  mqlSignals: [{ type: String }],
  mqlUpdatedAt: { type: Date },
  mqlModel: { type: String },
  mqlRulesHash: { type: String },
  messageCount: { type: Number, default: 0 },
  mqlLastScoredMessageCount: { type: Number, default: 0 },
  mqlScoring: { type: Boolean, default: false },
  inboundMessageCount: { type: Number, default: 0 },
  metaConversions: {
    mqlQualifiedSending: { type: Boolean, default: false },
    mqlQualifiedEventId: { type: String },
    mqlQualifiedAttemptedAt: { type: Date },
    mqlQualifiedSentAt: { type: Date },
    mqlQualifiedLastError: { type: String },
    mqlQualifiedLastStatus: { type: Number },
  },
  createdAt: { type: Date, default: Date.now }
});

// Index to ensure unique contact per client
ConversationSchema.index({ clientId: 1, whatsappAccountId: 1, contactPhone: 1 }, { unique: true });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
