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

// ✅ Middleware to parse JSON bodies
app.use(express.json());


const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: false, // Enable SSL
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_W20RdBZDYpvH@ep-white-shadow-a1wu6egm-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
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

  app.get("/", (req, res) => {
  res.send("Hello from Vercel websocket backend!");
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



// In-memory "database" for dummy data
// let users = [
//   { id: 1, name: 'John Doe', email: 'john@example.com' },
//   { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
// ];

// Get all users
// app.get('/api/users', (req, res) => {
//   res.status(200).json(users);
// });

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.message);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Routes here
app.post('/api/users', async (req, res) => {
  try {
    const { name, phone_number, email, profile_picture_url, status } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({ message: 'Name and phone number are required' });
    }

    const result = await pool.query(
      `INSERT INTO users (name, phone_number, email, profile_picture_url, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, phone_number, email || null, profile_picture_url || null, status || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting user:', err.message);
    if (err.code === '23505') {
      res.status(409).json({ message: 'Phone number or email already exists' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
});


//-------------otp apis--------------------

const crypto = require('crypto'); // for secure OTP
const dayjs = require('dayjs');

// Helper to generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/api/send-otp', async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ message: 'Phone number is required' });
  }

  const client = await pool.connect();

  try {
    const otp = generateOTP();
    const expiresAt = dayjs().add(5, 'minute').toISOString(); // 5 min expiry

    await client.query('BEGIN');

    // 1. Check if user exists
    const userResult = await client.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [phone_number]
    );

    if (userResult.rows.length === 0) {
      // Insert new user (default name or status can be adjusted)
      await client.query(
        'INSERT INTO users (name, phone_number) VALUES ($1, $2)',
        ['User', phone_number]
      );
    } else {
      // Update status (if needed)
      await client.query(
        'UPDATE users SET status = $1 WHERE phone_number = $2',
        ['pending_otp', phone_number]
      );
    }

    // 2. UPSERT OTP
    await client.query(
      `INSERT INTO otp_requests (phone_number, otp_code, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_number)
       DO UPDATE SET otp_code = EXCLUDED.otp_code, is_verified = false, created_at = CURRENT_TIMESTAMP, expires_at = EXCLUDED.expires_at`,
      [phone_number, otp, expiresAt]
    );

    await client.query('COMMIT');


    console.log(`Sending OTP ${otp} to ${phone_number}`);

    res.status(200).json({ message: 'OTP sent successfully', phone_number, otp }); // remove otp in prod
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error sending OTP:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
