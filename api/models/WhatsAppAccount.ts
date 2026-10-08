import mongoose, { Schema, Document, Types } from 'mongoose';

export type WhatsAppProvider = 'evolution' | 'cloud';

export interface IWhatsAppAccount extends Document {
  clientId: Types.ObjectId;
  provider: WhatsAppProvider;
  displayName?: string;
  instanceId?: string;
  cloudWabaId?: string;
  cloudPhoneNumberId?: string;
  cloudDisplayPhoneNumber?: string;
  status: 'connected' | 'disconnected' | 'pending';
  phoneNumber?: string;
  connectedAt?: Date;
  createdAt: Date;
}

const WhatsAppAccountSchema = new Schema<IWhatsAppAccount>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  provider: { type: String, enum: ['evolution', 'cloud'], default: 'evolution' },
  displayName: { type: String },
  instanceId: { type: String },
  cloudWabaId: { type: String },
  cloudPhoneNumberId: { type: String },
  cloudDisplayPhoneNumber: { type: String },
  status: { type: String, enum: ['connected', 'disconnected', 'pending'], default: 'pending' },
  phoneNumber: { type: String },
  connectedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

WhatsAppAccountSchema.index(
  { instanceId: 1 },
  { unique: true, partialFilterExpression: { instanceId: { $type: 'string' } } },
);

WhatsAppAccountSchema.index(
  { cloudPhoneNumberId: 1 },
  { unique: true, partialFilterExpression: { cloudPhoneNumberId: { $type: 'string' } } },
);

WhatsAppAccountSchema.index({ clientId: 1, createdAt: -1 });

export default mongoose.model<IWhatsAppAccount>('WhatsAppAccount', WhatsAppAccountSchema);
