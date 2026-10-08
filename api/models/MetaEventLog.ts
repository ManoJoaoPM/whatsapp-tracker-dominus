import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Durable outbox + audit trail for every event sent to Meta.
 *
 * pending  -> waiting for its first attempt or for a scheduled retry (nextAttemptAt)
 * sending  -> claimed by a worker (lockedAt); recovered if the worker dies
 * sent     -> Meta confirmed it received the event
 * failed   -> gave up (non-retryable error or no attempts left); can be resent manually
 */
export type MetaEventStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface IMetaEventLog extends Document {
  clientId: Types.ObjectId;
  conversationId: Types.ObjectId;
  eventName: string;
  eventId: string;
  /** `${conversationId}:${eventName}`: one event per conversation and name, ever */
  dedupeKey: string;
  status: MetaEventStatus;
  attempts: number;
  manualRetries: number;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  lastAttemptAt?: Date;
  sentAt?: Date;
  lastError?: string;
  lastHttpStatus?: number;
  lastMetaCode?: number;
  eventsReceived?: number;
  /** Event object exactly as built (hashed identifiers only, never the access token) */
  event: any;
  requestBody?: any;
  responseBody?: any;
  createdAt: Date;
  updatedAt: Date;
}

const MetaEventLogSchema = new Schema<IMetaEventLog>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    eventName: { type: String, required: true },
    eventId: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    manualRetries: { type: Number, default: 0 },
    nextAttemptAt: { type: Date },
    lockedAt: { type: Date },
    lastAttemptAt: { type: Date },
    sentAt: { type: Date },
    lastError: { type: String },
    lastHttpStatus: { type: Number },
    lastMetaCode: { type: Number },
    eventsReceived: { type: Number },
    event: { type: Schema.Types.Mixed, required: true },
    requestBody: { type: Schema.Types.Mixed },
    responseBody: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

MetaEventLogSchema.index({ dedupeKey: 1 }, { unique: true });
MetaEventLogSchema.index({ status: 1, nextAttemptAt: 1 });
MetaEventLogSchema.index({ clientId: 1, createdAt: -1 });
MetaEventLogSchema.index({ clientId: 1, status: 1, createdAt: -1 });

export default mongoose.model<IMetaEventLog>('MetaEventLog', MetaEventLogSchema);
