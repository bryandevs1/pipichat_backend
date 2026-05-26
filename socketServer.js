const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const db = require("./config/db");
const { getFullUserProfileUrl, getFullMediaUrl } = require("./utils/urlNormalizer");

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "https://server.pipiafrica.com",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Track online users: Map<userId, {socketId, timestamp, userInfo}>
  const onlineUsers = new Map();

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    console.log("Socket.IO incoming connection:", {
      socketId: socket.id,
      authToken: socket.handshake.auth.token,
      queryToken: socket.handshake.query.token,
      headers: socket.handshake.headers,
    });
    if (!token) {
      console.error("Socket.IO auth error: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("Socket.IO token decoded:", decoded);
      socket.user = decoded;
      next();
    } catch (error) {
      console.error("Socket.IO auth error:", {
        message: error.message,
        stack: error.stack,
        token,
      });
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id || socket.user.user_id;
    console.log(
      `New client connected: ${socket.id}, User ID: ${userId}`
    );

    try {
      // Mark user as online
      onlineUsers.set(userId, {
        socketId: socket.id,
        timestamp: new Date(),
        userId: userId,
      });

      console.log(`✅ User ${userId} is now ONLINE`);
      console.log(`Currently online users: ${onlineUsers.size}`);

      // Broadcast user is online to all clients
      io.emit("user-online", {
        userId,
        timestamp: new Date(),
      });

      // Send current online users list to this client
      const onlineUsersList = Array.from(onlineUsers.keys());
      socket.emit("online-users", { onlineUsers: onlineUsersList });

      const [conversations] = await db.query(
        `SELECT conversation_id FROM conversations_users WHERE user_id = ?`,
        [userId]
      );
      console.log("Conversations fetched for user:", {
        userId,
        conversations,
      });
      conversations.forEach((conv) => {
        const room = `conversation:${conv.conversation_id}`;
        socket.join(room);
        console.log(`User ${userId} joined room ${room}`);

        // Notify conversation members that this user is online
        io.to(room).emit("user-online-in-conversation", {
          userId,
          conversationId: conv.conversation_id,
          timestamp: new Date(),
        });
      });
    } catch (error) {
      console.error("Error on user connection:", {
        message: error.message,
        stack: error.stack,
      });
    }

    // Join specific conversation
    socket.on("join-conversation", ({ conversationId }) => {
      const room = `conversation:${conversationId}`;
      socket.join(room);
      console.log(`User ${socket.user.id} joined conversation room: ${room}`);
    });

    // Handle new message event
    socket.on("send-message", async (data) => {
      try {
        const { conversationId, message, image, voiceNote } = data;
        const userId = socket.user.id || socket.user.user_id;
        
        console.log("Message received via socket:", {
          conversationId,
          userId,
          message,
          hasImage: !!image,
          hasVoiceNote: !!voiceNote,
        });

        // Fetch sender user info
        const [userInfo] = await db.query(
          `SELECT user_id, user_name, user_picture, user_verified, user_firstname, user_lastname 
           FROM users WHERE user_id = ?`,
          [userId]
        );

        if (!userInfo.length) {
          socket.emit("message-error", { error: "User not found" });
          return;
        }

        // Normalize URLs
        const normalizedUserPicture = getFullUserProfileUrl(userInfo[0].user_picture);
        const normalizedImage = image ? getFullMediaUrl(image) : null;
        const normalizedVoiceNote = voiceNote ? getFullMediaUrl(voiceNote) : null;

        // Broadcast to conversation room
        const room = `conversation:${conversationId}`;
        io.to(room).emit("new-message", {
          conversationId,
          userId,
          message,
          image: normalizedImage,
          voiceNote: normalizedVoiceNote,
          userName: userInfo[0].user_name,
          userPicture: normalizedUserPicture,
          userVerified: userInfo[0].user_verified,
          timestamp: new Date().toISOString(),
        });

        console.log(`✅ Message broadcasted to room ${room}`);
      } catch (error) {
        console.error("Error handling send-message:", error);
        socket.emit("message-error", { error: error.message });
      }
    });

    // Handle typing status
    socket.on("typing", async (data) => {
      try {
        const { conversationId, isTyping } = data;
        const userId = socket.user.id || socket.user.user_id;
        const room = `conversation:${conversationId}`;
        
        socket.to(room).emit("user-typing", {
          userId,
          conversationId,
          isTyping,
        });
      } catch (error) {
        console.error("Error handling typing:", error);
      }
    });

    // Handle message seen
    socket.on("message-seen", async (data) => {
      try {
        const { conversationId, messageId } = data;
        const userId = socket.user.id || socket.user.user_id;
        const room = `conversation:${conversationId}`;
        
        socket.to(room).emit("message-seen", {
          userId,
          conversationId,
          messageId,
        });
      } catch (error) {
        console.error("Error handling message-seen:", error);
      }
    });

    // Join call room
    socket.on("join-call-room", (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined call room ${roomId}`);
    });

    socket.on("offer", (data) => {
      const { roomId, offer } = data;
      console.log(`Offer received from ${socket.id} for room ${roomId}`);
      socket.to(roomId).emit("offer", offer);
    });

    socket.on("answer", (data) => {
      const { roomId, answer } = data;
      console.log(`Answer received from ${socket.id} for room ${roomId}`);
      socket.to(roomId).emit("answer", answer);
    });

    socket.on("ice-candidate", (data) => {
      const { roomId, candidate } = data;
      console.log(
        `ICE candidate received from ${socket.id} for room ${roomId}`
      );
      socket.to(roomId).emit("ice-candidate", candidate);
    });

    socket.on("end-call", (roomId) => {
      console.log(`End call received from ${socket.id} for room ${roomId}`);
      socket.to(roomId).emit("call-ended");
      socket.leave(roomId);
    });

    socket.on("disconnect", () => {
      const userId = socket.user.id || socket.user.user_id;
      console.log(
        `Client disconnected: ${socket.id}, User ID: ${userId}`
      );

      // Mark user as offline
      onlineUsers.delete(userId);
      console.log(`❌ User ${userId} is now OFFLINE`);
      console.log(`Currently online users: ${onlineUsers.size}`);

      // Broadcast user is offline to all clients
      io.emit("user-offline", {
        userId,
        timestamp: new Date(),
      });
    });
  });

  return io;
};
