import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * One row per qualification run: what was judged, with which prompt/model/rules, and why.
 * It is the audit trail behind every score and Meta event, and the data set for calibration.
 */
export interface IMqlEvaluation extends Document {
  clientId: Types.ObjectId;
  conversationId: Types.ObjectId;
  trigger: 'message' | 'silence' | 'manual';
  /** final score after product rules */
  score: number;
  level: 'cold' | 'warm' | 'hot';
  /** score from the verified criteria, before product rules */
  criteriaScore: number;
  /** score of the skeptical second pass, when it ran */
  confirmationScore?: number;
  confirmed: boolean;
  floorApplied: boolean;
  summary: string;
  signals: string[];
  criteria: Array<{ id: string; label: string; weight: number; met: boolean; evidence: string; rejected?: string }>;
  manipulationAttempt: boolean;
  injectionDetected: boolean;
  promptVersion: string;
  modelName: string;
  rulesHash: string;
  messageCount: number;
  inboundCount: number;
  createdAt: Date;
}

const MqlEvaluationSchema = new Schema<IMqlEvaluation>({
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  trigger: { type: String, enum: ['message', 'silence', 'manual'], required: true },
  score: { type: Number, required: true },
  level: { type: String, enum: ['cold', 'warm', 'hot'], required: true },
  criteriaScore: { type: Number, required: true },
  confirmationScore: { type: Number },
  confirmed: { type: Boolean, default: false },
  floorApplied: { type: Boolean, default: false },
  summary: { type: String, default: '' },
  signals: [{ type: String }],
  criteria: [
    new Schema(
      {
        id: { type: String },
        label: { type: String },
        weight: { type: Number },
        met: { type: Boolean },
        evidence: { type: String },
        rejected: { type: String },
      },
      { _id: false },
    ),
  ],
  manipulationAttempt: { type: Boolean, default: false },
  injectionDetected: { type: Boolean, default: false },
  promptVersion: { type: String, required: true },
  modelName: { type: String, required: true },
  rulesHash: { type: String, required: true },
  messageCount: { type: Number, default: 0 },
  inboundCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

MqlEvaluationSchema.index({ conversationId: 1, createdAt: -1 });
MqlEvaluationSchema.index({ clientId: 1, createdAt: -1 });

export default mongoose.model<IMqlEvaluation>('MqlEvaluation', MqlEvaluationSchema);
