import mongoose, { Schema, Document } from 'mongoose';

export interface IClient extends Document {
  name: string;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  whatsappInstance?: {
    instanceId: string;
    status: 'connected' | 'disconnected' | 'pending';
    phoneNumber?: string;
    connectedAt?: Date;
  };
  /** Business context for the evaluator (what is sold, ideal customer). Not a scoring rubric. */
  mqlRules?: string;
  mqlTemplate?: string;
  mqlCriteria?: Array<{
    id: string;
    label: string;
    description: string;
    weight: number;
    source: 'lead' | 'any';
  }>;
  metaAds?: {
    pixelId?: string;
    pageId?: string;
    capiAccessTokenEnc?: string;
    mqlTriggerLevel?: 'cold' | 'warm' | 'hot';
    sendUntracked?: boolean;
    currency?: string;
    events?: {
      leadSubmitted?: { enabled?: boolean; minInbound?: number };
      qualifiedLead?: { enabled?: boolean };
      purchase?: { enabled?: boolean };
    };
    updatedAt?: Date;
  };
}

const ClientSchema = new Schema<IClient>({
  name: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  whatsappInstance: {
    instanceId: { type: String },
    status: { type: String, enum: ['connected', 'disconnected', 'pending'], default: 'pending' },
    phoneNumber: { type: String },
    connectedAt: { type: Date }
  },
  mqlRules: { type: String },
  mqlTemplate: { type: String },
  mqlCriteria: [
    new Schema(
      {
        id: { type: String, required: true },
        label: { type: String, required: true },
        description: { type: String, required: true },
        weight: { type: Number, required: true },
        source: { type: String, enum: ['lead', 'any'], default: 'lead' },
      },
      { _id: false },
    ),
  ],
  metaAds: {
    pixelId: { type: String },
    pageId: { type: String },
    capiAccessTokenEnc: { type: String, select: false },
    mqlTriggerLevel: { type: String, enum: ['cold', 'warm', 'hot'], default: 'hot' },
    // Send events for Meta leads that have no ctwa_clid (weak match, lowers match quality)
    sendUntracked: { type: Boolean, default: false },
    // ISO 4217 code used as the currency of Purchase events
    currency: { type: String, default: 'BRL' },
    // Which steps of the funnel are sent to Meta
    events: {
      leadSubmitted: {
        enabled: { type: Boolean, default: false },
        minInbound: { type: Number, default: 2 },
      },
      qualifiedLead: { enabled: { type: Boolean, default: true } },
      purchase: { enabled: { type: Boolean, default: false } },
    },
    updatedAt: { type: Date },
  },
});

export default mongoose.model<IClient>('Client', ClientSchema);
