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
  mqlRules?: string;
  metaAds?: {
    pixelId?: string;
    pageId?: string;
    capiAccessTokenEnc?: string;
    mqlTriggerLevel?: 'cold' | 'warm' | 'hot';
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
  metaAds: {
    pixelId: { type: String },
    pageId: { type: String },
    capiAccessTokenEnc: { type: String, select: false },
    mqlTriggerLevel: { type: String, enum: ['cold', 'warm', 'hot'], default: 'hot' },
    updatedAt: { type: Date },
  },
});

export default mongoose.model<IClient>('Client', ClientSchema);
