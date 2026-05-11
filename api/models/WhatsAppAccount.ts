import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWhatsAppAccount extends Document {
  clientId: Types.ObjectId;
  displayName?: string;
  instanceId: string;
  status: 'connected' | 'disconnected' | 'pending';
  phoneNumber?: string;
  connectedAt?: Date;
  createdAt: Date;
}

const WhatsAppAccountSchema = new Schema<IWhatsAppAccount>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  displayName: { type: String },
  instanceId: { type: String, required: true, unique: true },
  status: { type: String, enum: ['connected', 'disconnected', 'pending'], default: 'pending' },
  phoneNumber: { type: String },
  connectedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

WhatsAppAccountSchema.index({ clientId: 1, createdAt: -1 });

export default mongoose.model<IWhatsAppAccount>('WhatsAppAccount', WhatsAppAccountSchema);

