const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:8100',
    methods: ['GET', 'POST'],
  },
});

// PostgreSQL Pool
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'telldemm',
  password: 'Admin@123',
  port: 5432,
});

// Save message to PostgreSQL
async function saveMessage(msg) {
  const query = `
    INSERT INTO messages (sender_id, receiver_id, group_id, content, media_url, message_type, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const values = [
    msg.sender_id || null,
    msg.receiver_id || null,
    msg.group_id || null,
    msg.content || null,
    msg.media_url || null,
    msg.message_type || 'text',
    'sent',
  ];

  try {
    const res = await pool.query(query, values);
    return res.rows[0];
  } catch (err) {
    console.error('DB Save Error:', err);
    return null;
  }
}

const userSocketMap = new Map(); // userId → socket.id
const allowedUserIds = new Set(); // Only 2 users allowed

io.on('connection', (socket) => {
  console.log('New user trying to connect');

  // Handle joinChat
  socket.on('joinChat', (userId) => {
    if (!userId) {
      socket.emit('error', 'User ID is required');
      socket.disconnect();
      return;
    }

    if (!allowedUserIds.has(userId) && allowedUserIds.size >= 2) {
      socket.emit('connectionRejected', 'Only 2 users can chat at a time');
      socket.disconnect();
      return;
    }

    userSocketMap.set(userId, socket.id);
    allowedUserIds.add(userId);
    socket.userId = userId;

    console.log(`User ${userId} connected`);
    socket.emit('joined', 'Connected to chat');
  });

  // Handle incoming message
  socket.on('chatMessage', (msg) => {
    try {
      console.log('Received message:', msg);

      if (!msg || typeof msg.user !== 'string' || typeof msg.text !== 'string') {
        console.error('Invalid message format:', msg);
        return;
      }

      const senderId = msg.user;

      if (!allowedUserIds.has(senderId)) {
        console.log(`User ${senderId} is not allowed to send messages`);
        return;
      }

      const receiverId = [...allowedUserIds].find(id => id !== senderId) || null;

      const messagePayload = {
        sender_id: senderId,
        receiver_id: receiverId,
        group_id: null, // or assign if needed
        content: msg.text,
        media_url: msg.media_url || null,
        message_type: msg.message_type || 'text'
      };

      // Emit message to both users
      // allowedUserIds.forEach(userId => {
      //   const targetSocketId = userSocketMap.get(userId);
      //   if (targetSocketId) {
      //     io.to(targetSocketId).emit('message', {
      //       ...messagePayload,
      //       timestamp: new Date().toISOString()
      //     });
      //   }
      // });

       // Emit only to the 2 allowed users (sender and other)
      allowedUserIds.forEach(userId => {
        const targetSocketId = userSocketMap.get(userId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('message', msg);
        }
      });

      // Save message to DB
      saveMessage(messagePayload)
        .then(savedMsg => {
          if (savedMsg) {
            console.log('Message saved with id:', savedMsg.message_id || savedMsg.id);
          }
        })
        .catch(err => {
          console.error('Error saving message:', err);
        });

    } catch (error) {
      console.error('Error processing chatMessage:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    const userId = socket.userId;
    console.log(`User disconnected: ${userId} (${reason})`);

    if (userId) {
      allowedUserIds.delete(userId);
      userSocketMap.delete(userId);
    }
  });
});

app.get("/", (req, res) => {
  res.send("Hello from Vercel websocket backend!");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
