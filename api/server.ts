/**
 * local server entry file, for local development
 */
import './config/env.js';
import app from './app.js';
import connectDB from './config/db.js';
import { getJwtSecret, verifyAuthToken } from './config/jwt.js';
import { startMetaEventWorker } from './services/metaEventQueue.js';
import { startMqlWorker } from './services/mqlAutoScore.js';
import User from './models/User.js';
import Client from './models/Client.js';
import { Server } from 'socket.io';
import mongoose from 'mongoose';

/**
 * fail fast when required secrets are missing
 */
getJwtSecret();

/**
 * connect to database
 */
connectDB();

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});

/**
 * Socket.io setup
 */
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Only authenticated users may open a socket
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      return next(new Error('unauthorized'));
    }
    const { id } = verifyAuthToken(token);
    const user = await User.findById(id).select('_id');
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = String(user._id);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId: string = socket.data.userId;
  console.log(`[socket] Client connected: ${socket.id}, user: ${userId}`);

  socket.on('join', async (roomClientId, ack) => {
    const reply = (payload: Record<string, unknown>) => {
      if (typeof ack === 'function') ack(payload);
    };

    try {
      const room = String(roomClientId || '');
      // The room is the clientId: the user must own that client
      const owns = mongoose.isValidObjectId(room)
        ? await Client.exists({ _id: room, userId })
        : null;

      if (!owns) {
        console.warn(`[socket] Socket ${socket.id} (user ${userId}) denied access to room ${room}`);
        reply({ ok: false, error: 'forbidden' });
        return;
      }

      socket.join(room);
      const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
      console.log(`Socket ${socket.id} joined room ${room} (size=${roomSize})`);
      reply({ ok: true, room, socketId: socket.id, roomSize });
    } catch (error) {
      console.error('[socket] join error', error);
      reply({ ok: false, error: 'internal' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

// Attach io to app so routes can use it
app.set('io', io);

// Delivers (and retries) the events queued for Meta
startMetaEventWorker();

// Scores conversations once they have been quiet for a while, and re-evaluates silent leads
startMqlWorker(io);

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
