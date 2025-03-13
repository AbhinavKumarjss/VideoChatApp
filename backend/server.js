const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());

const server = http.createServer(app);
console.log("Opened to : " + process.env.CLIENT_URL);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000, // Increase ping timeout to prevent premature disconnections
  pingInterval: 25000, // Ping clients regularly to maintain connection
});

// Store active rooms and users
const rooms = {};
const socketToRoom = {};

// Debug function to log room state
const logRoomState = () => {
  console.log('\n--- CURRENT ROOMS STATE ---');
  if (Object.keys(rooms).length === 0) {
    console.log('No active rooms');
  } else {
    Object.entries(rooms).forEach(([roomId, users]) => {
      console.log(`Room ${roomId}: ${users.length} users`);
      users.forEach(user => console.log(`  - ${user.username} (${user.id})`));
    });
  }
  console.log('-------------------------\n');
};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Handle ping to test connection
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ status: 'ok', timestamp: Date.now() });
    }
  });

  // Join a room
  socket.on('join-room', ({ roomId, username }) => {
    console.log(`${username} (${socket.id}) joining room: ${roomId}`);
    
    // Join the room
    socket.join(roomId);
    
    // Add user to the room
    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }
    
    // Add user to the room if not already there
    if (!rooms[roomId].some(user => user.id === socket.id)) {
      rooms[roomId].push({ id: socket.id, username });
    }
    
    // Send the current users in the room to the new user
    socket.emit('room-users', rooms[roomId]);
    
    // Notify other users in the room that a new user has joined
    socket.to(roomId).emit('user-joined', { callerID: socket.id, username });
    
    // Store the room ID for this socket
    socketToRoom[socket.id] = roomId;
    
    // Set up a periodic check to ensure all users in the room are connected to each other
    if (!socket.roomCheckInterval) {
      socket.roomCheckInterval = setInterval(() => {
        if (rooms[roomId] && rooms[roomId].length > 1) {
          console.log(`Periodic room check for ${roomId}: ${rooms[roomId].length} users`);
          
          // Send the current users in the room to all users
          io.to(roomId).emit('room-users', rooms[roomId]);
        }
      }, 30000); // Check every 30 seconds
    }
  });

  // Handle sending signals
  socket.on('sending-signal', ({ userToSignal, callerID, signal, username }) => {
    console.log(`${username} (${callerID}) sending signal to ${userToSignal}`);
    io.to(userToSignal).emit('receiving-signal', { signal, callerID, username });
  });

  // Handle returning signals
  socket.on('returning-signal', ({ signal, callerID }) => {
    console.log(`${socket.id} returning signal to ${callerID}`);
    io.to(callerID).emit('receiving-returned-signal', { signal, id: socket.id });
  });

  // Handle ICE candidates
  socket.on('ice-candidate', ({ candidate, to }) => {
    console.log(`${socket.id} sending ICE candidate to ${to}`);
    io.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  // Handle reconnection requests
  socket.on('request-reconnection', ({ roomId }) => {
    console.log(`${socket.id} requesting reconnection in room ${roomId}`);
    
    if (rooms[roomId]) {
      // Get the username of the requesting user
      const roomUsers = rooms[roomId];
      const user = roomUsers.find(u => u.id === socket.id);
      if (!user) {
        console.log(`User ${socket.id} not found in room ${roomId}`);
        return;
      }
      
      // Notify all other users in the room to reconnect with this user
      roomUsers.forEach(otherUser => {
        if (otherUser.id !== socket.id) {
          console.log(`Telling ${otherUser.id} to reconnect with ${socket.id}`);
          io.to(otherUser.id).emit('reconnect-with-peer', { 
            peerId: socket.id, 
            username: user.username 
          });
          
          // Also tell this user to reconnect with the other user
          io.to(socket.id).emit('reconnect-with-peer', { 
            peerId: otherUser.id, 
            username: otherUser.username 
          });
        }
      });
    }
  });

  // Handle chat messages
  socket.on('send-message', ({ roomId, message }) => {
    console.log(`Message in room ${roomId} from ${message.sender}: ${message.content}`);
    socket.to(roomId).emit('receive-message', message);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Get the room this socket was in
    const roomId = socketToRoom[socket.id];
    if (roomId) {
      // Remove user from the room
      if (rooms[roomId]) {
        const roomUsers = rooms[roomId];
        if (roomUsers) {
          const updatedUsers = roomUsers.filter(user => user.id !== socket.id);
          rooms[roomId] = updatedUsers;
          
          // If the room is empty, delete it
          if (updatedUsers.length === 0) {
            console.log(`Room ${roomId} is now empty, removing it`);
            delete rooms[roomId];
          } else {
            // Notify other users in the room that this user has left
            socket.to(roomId).emit('user-left', socket.id);
          }
        }
      }
      
      // Remove the socket from the mapping
      delete socketToRoom[socket.id];
      
      // Clear room check interval
      if (socket.roomCheckInterval) {
        clearInterval(socket.roomCheckInterval);
        socket.roomCheckInterval = null;
      }
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.send('Video Chat Server is running');
});

app.get('/status', (req, res) => {
  const status = {
    server: 'running',
    rooms: Object.entries(rooms).map(([roomId, users]) => ({
      roomId,
      userCount: users.length,
      users: users.map(u => ({ id: u.id, username: u.username }))
    }))
  };
  res.json(status);
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CORS allowed origin: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
}); 
