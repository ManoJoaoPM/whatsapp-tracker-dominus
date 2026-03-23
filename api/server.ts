/**
 * local server entry file, for local development
 */
import './config/env.js';
import app from './app.js';
import connectDB from './config/db.js';
import { Server } from 'socket.io';

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

io.on('connection', (socket) => {
  const { token, clientId } = socket.handshake.auth || {};
  console.log(`[socket] Client connected: ${socket.id}, token: ${!!token}, clientId: ${clientId}`);
  
  socket.on('join', (roomClientId, ack) => {
    // Check if the requested room matches the auth clientId
    if (clientId && roomClientId !== clientId) {
      console.warn(`[socket] Client ${socket.id} attempted to join room ${roomClientId} but is authorized for ${clientId}`);
    }

    const room = String(roomClientId);
    socket.join(room);

    const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
    console.log(`Socket ${socket.id} joined room ${room} (size=${roomSize})`);

    if (typeof ack === 'function') {
      ack({ ok: true, room, socketId: socket.id, roomSize });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected', socket.id);
  });
});

// Attach io to app so routes can use it
app.set('io', io);

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
