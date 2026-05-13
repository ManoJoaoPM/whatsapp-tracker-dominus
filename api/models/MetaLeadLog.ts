import mongoose, { Document, Schema } from 'mongoose';

export interface IMetaLeadLog extends Document {
  clientId: mongoose.Types.ObjectId;
  whatsappAccountId?: mongoose.Types.ObjectId;
  conversationId?: mongoose.Types.ObjectId;
  contactPhone: string;
  externalMessageId?: string;
  isFromMe?: boolean;
  ctwaClid?: string;
  sourceId?: string;
  rawPayload: any;
  createdAt: Date;
}

const metaLeadLogSchema = new Schema<IMetaLeadLog>({
  clientId: {
    type: Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
  },
  whatsappAccountId: {
    type: Schema.Types.ObjectId,
    ref: 'WhatsAppAccount',
    required: false,
  },
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: false,
  },
  contactPhone: {
    type: String,
    required: true,
  },
  externalMessageId: {
    type: String,
    required: false,
  },
  isFromMe: {
    type: Boolean,
    required: false,
  },
  ctwaClid: {
    type: String,
    required: false,
  },
  sourceId: {
    type: String,
    required: false,
  },
  rawPayload: {
    type: Schema.Types.Mixed,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

metaLeadLogSchema.index({ clientId: 1, createdAt: -1 });
metaLeadLogSchema.index({ clientId: 1, contactPhone: 1, createdAt: -1 });

export default mongoose.model<IMetaLeadLog>('MetaLeadLog', metaLeadLogSchema);
