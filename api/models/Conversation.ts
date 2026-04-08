import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  clientId: Types.ObjectId;
  contactPhone: string;
  contactName?: string;
  origin: 'meta_ads' | 'google_ads' | 'organic' | 'unknown';
  originConfidence: 'auto' | 'manual';
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
  createdAt: Date;
}

const ConversationSchema = new Schema<IConversation>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  contactPhone: { type: String, required: true },
  contactName: { type: String },
  origin: { type: String, enum: ['meta_ads', 'google_ads', 'organic', 'unknown'], default: 'unknown' },
  originConfidence: { type: String, enum: ['auto', 'manual'], default: 'auto' },
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
  createdAt: { type: Date, default: Date.now }
});

// Index to ensure unique contact per client
ConversationSchema.index({ clientId: 1, contactPhone: 1 }, { unique: true });

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
