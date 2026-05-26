const WebSocket = require("ws");
const storyController = require("./controllers/storyController");

const setupWebSocketServer = (server) => {
  const wss = new WebSocket.Server({ server, path: "/ws/stories" });

  wss.on("connection", (ws, req) => {
    console.log("New WebSocket connection");

    // Extract user_id from query parameters or headers
    const url = new URL(req.url, `http://${req.headers.host}`);
    const userId = url.searchParams.get("user_id");

    if (!userId) {
      ws.close(4001, "User ID required");
      return;
    }

    // Register the connection
    storyController.registerConnection(parseInt(userId), ws);

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        console.log("Received:", data);

        // Handle ping/pong for keep-alive
        if (data.type === "PING") {
          ws.send(
            JSON.stringify({
              type: "PONG",
              timestamp: new Date().toISOString(),
            })
          );
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    // Send initial connection confirmation
    ws.send(
      JSON.stringify({
        type: "CONNECTED",
        message: "WebSocket connection established",
        timestamp: new Date().toISOString(),
      })
    );
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "HEARTBEAT",
            timestamp: new Date().toISOString(),
          })
        );
      }
    });
  }, 30000); // Every 30 seconds

  return wss;
};

module.exports = setupWebSocketServer;
