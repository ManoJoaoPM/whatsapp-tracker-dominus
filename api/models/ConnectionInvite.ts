import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * A public link an agency sends to a customer so the customer can connect a WhatsApp number
 * without having an account. The link is a bearer credential: it is long and random, expires,
 * can be revoked and stops working for new QR codes once the number is connected.
 */
export type ConnectionInviteStatus = 'pending' | 'started' | 'connected' | 'revoked';

export interface IConnectionInvite extends Document {
  clientId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  /** sha256 of the token: how the public page finds the invite */
  tokenHash: string;
  /** the token encrypted with the master key, so the agency can copy the link again */
  tokenEnc: string;
  /** name the connected number will have in the panel (e.g. "Comercial") */
  displayName?: string;
  status: ConnectionInviteStatus;
  whatsappAccountId?: Types.ObjectId;
  /** set while the WhatsApp instance is being created, so two requests never create two */
  provisioningAt?: Date;
  expiresAt: Date;
  startedAt?: Date;
  connectedAt?: Date;
  createdAt: Date;
}

const ConnectionInviteSchema = new Schema<IConnectionInvite>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  tokenHash: { type: String, required: true },
  tokenEnc: { type: String, required: true, select: false },
  displayName: { type: String },
  status: { type: String, enum: ['pending', 'started', 'connected', 'revoked'], default: 'pending' },
  whatsappAccountId: { type: Schema.Types.ObjectId, ref: 'WhatsAppAccount' },
  provisioningAt: { type: Date },
  expiresAt: { type: Date, required: true },
  startedAt: { type: Date },
  connectedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

ConnectionInviteSchema.index({ tokenHash: 1 }, { unique: true });
ConnectionInviteSchema.index({ clientId: 1, createdAt: -1 });

export default mongoose.model<IConnectionInvite>('ConnectionInvite', ConnectionInviteSchema);
