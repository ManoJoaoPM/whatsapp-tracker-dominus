import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOriginEvent extends Document {
  clientId: Types.ObjectId;
  contactPhone?: string;
  rawParams: Record<string, string>;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  capturedAt: Date;
}

const OriginEventSchema = new Schema<IOriginEvent>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  contactPhone: { type: String },
  rawParams: { type: Map, of: String },
  utmSource: { type: String },
  utmMedium: { type: String },
  utmCampaign: { type: String },
  referrer: { type: String },
  capturedAt: { type: Date, default: Date.now }
});

export default mongoose.model<IOriginEvent>('OriginEvent', OriginEventSchema);