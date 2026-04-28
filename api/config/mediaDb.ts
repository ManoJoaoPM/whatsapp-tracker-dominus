import mongoose, { type Connection, type Model } from 'mongoose';
import type { IMessage } from '../models/Message.js';
import { MessageSchema } from '../models/Message.js';

let mediaConn: Connection | null = null;
let MediaMessageModel: Model<IMessage> | null = null;
let mediaConnectPromise: Promise<void> | null = null;

const connectMediaDb = async (): Promise<void> => {
  const uri = process.env.MEDIA_MONGODB_URI;
  if (!uri) return;

  if (mediaConn && mediaConn.readyState === 1 && MediaMessageModel) return;

  if (!mediaConnectPromise) {
    mediaConnectPromise = (async () => {
      const conn = await mongoose.createConnection(uri).asPromise();
      mediaConn = conn;
      MediaMessageModel = conn.model<IMessage>('Message', MessageSchema);
    })().finally(() => {
      mediaConnectPromise = null;
    });
  }

  await mediaConnectPromise;
};

export const getMediaMessageModel = async (): Promise<Model<IMessage> | null> => {
  if (!process.env.MEDIA_MONGODB_URI) return null;
  await connectMediaDb();
  return MediaMessageModel;
};

