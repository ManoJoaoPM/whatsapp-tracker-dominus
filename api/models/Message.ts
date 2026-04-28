import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  conversationId: Types.ObjectId;
  clientId: Types.ObjectId;
  direction: 'inbound' | 'outbound';
  content: string;
  mediaType: 'text' | 'image' | 'audio' | 'document' | 'null';
  mediaUrl?: string;
  timestamp: Date;
  externalMessageId?: string;
}

export const MessageSchema = new Schema<IMessage>({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  content: { type: String, required: true },
  mediaType: { type: String, enum: ['text', 'image', 'audio', 'document', 'null'], default: 'text' },
  mediaUrl: { type: String },
  timestamp: { type: Date, default: Date.now },
  externalMessageId: { type: String }
});

export default mongoose.model<IMessage>('Message', MessageSchema);
