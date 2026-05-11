import mongoose, { Document, Schema } from 'mongoose';

export interface IMetaLeadLog extends Document {
  clientId: mongoose.Types.ObjectId;
  contactPhone: string;
  rawPayload: any;
  createdAt: Date;
}

const metaLeadLogSchema = new Schema<IMetaLeadLog>({
  clientId: {
    type: Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
  },
  contactPhone: {
    type: String,
    required: true,
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

export default mongoose.model<IMetaLeadLog>('MetaLeadLog', metaLeadLogSchema);
