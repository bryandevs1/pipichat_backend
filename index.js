const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");
const dotenv = require("dotenv");
const db = require("./config/db");
const http = require("http");
const socketio = require("socket.io");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
const serviceAccount = require("./africanawa-firebase-adminsdk-fbsvc-023b83f98a.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
// Import controllers
const SocketController = require("./controllers/socketController");

// Import routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const friendsRoutes = require("./routes/friendsRoutes");
const walletRoutes = require("./routes/walletRoutes");
const postRoutes = require("./routes/postRoutes");
const createPostRoutes = require("./routes/createPostRoutes");
const followingRoutes = require("./routes/followingRoutes");
const privacyRoutes = require("./routes/privacyRoutes");
const blockRoutes = require("./routes/blockRoutes");
const withdrawRoutes = require("./routes/withdrawRoutes");
const verificationRoutes = require("./routes/verificationRoute");
const chatRoutes = require("./routes/chatRoutes");
const agoraRoutes = require("./routes/agoraRoutes"); // New
const { createPost } = require("./controllers/postController");
const upload = require("./middleware/upload");
const notificationRoutes = require("./routes/notificationRoutes");
const groupRoutes = require("./routes/groupRoutes");
const monetizationRoutes = require("./routes/monetizationRoutes");
const storyRoutes = require("./routes/storyRoutes");
const affiliateRoutes = require("./routes/affiliateRoutes");
const fundingRoutes = require("./routes/fundingRoutes");
const pagesRoutes = require("./routes/pagesRoutes");
const eventsRoutes = require("./routes/eventRoutes");
const adsRoutes = require("./routes/adsRoutes");
const webhooksRoutes = require("./routes/webhooks");
const membershipRoutes = require("./routes/membershipRoutes");

dotenv.config();
const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = socketio(server, {
  cors: {
    origin: "*", // Configure properly for production
    methods: ["GET", "POST"],
    credentials: true,
    transports: ["websocket", "polling"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Initialize Socket Controller
const socketController = new SocketController(io);
socketController.initializeSocket();

// Middleware
app.use(cors());
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      if (
        req.originalUrl.includes("/webhook") ||
        req.originalUrl.includes("/fund/webhook")
      ) {
        req.rawBody = buf.toString();
      }
    },
  }),
);

app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/uploads", express.static("uploads"));
app.post("/api/post/uploads", upload.single("file"), createPost);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendsRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/post", createPostRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/api/blocking", blockRoutes);
app.use("/api/monetization", monetizationRoutes);
app.use("/api/withdraw", withdrawRoutes);
app.use("/api/affiliates", affiliateRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/following", followingRoutes);
app.use("/api/funding", fundingRoutes);
app.use("/api/chat", chatRoutes); // Updated path
app.use("/api/agora", agoraRoutes); // New
app.use("/api/stories", storyRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/pages", pagesRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/ads", adsRoutes);
app.use("/api/webhooks", webhooksRoutes);
app.use("/api/membership", membershipRoutes);

// Logging middleware
app.use(async (req, res, next) => {
  const start = Date.now();
  const token = req.headers.authorization?.split(" ")[1];
  let tokenStatus = "no token";

  const originalSend = res.send;
  res.send = function (body) {
    const responseTime = Date.now() - start;
    console.log(`🟢 [${req.method}] ${req.url}`);
    console.log("Response Status:", res.statusCode);
    console.log("Response Time:", `${responseTime}ms`);
    console.log("Token Status:", tokenStatus);
    console.log("--------------------------------------");
    return originalSend.call(this, body);
  };

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      tokenStatus = `valid (userId: ${decoded.id || decoded.user_id || "unknown"})`;
      req.user = decoded;
    } catch (err) {
      tokenStatus = "invalid or expired";
    }
  }

  next();
});

// Default route
app.get("/", (req, res) => {
  res.send("Social Media API is running.");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      database: "connected",
      socket: "running",
      agora: "configured",
    },
  });
});

// Start server
const PORT = process.env.PORT || 5200;
server.listen(PORT, () => {
  console.log(`🟢 Express API is running on port ${PORT}`);
  console.log(`🟢 Socket.IO server is running on port ${PORT}`);
  console.log(`🟢 Agora integration ready`);
});

// Export for testing
module.exports = { app, server, io };
