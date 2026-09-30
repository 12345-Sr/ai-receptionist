require("dotenv").config();
const http = require("http");
const express = require("express");
const connectDB = require("./config/db");

const dataRoutes = require("./routes/dataRoutes");
const exotelRoutes = require("./routes/exotelRoutes");
const { setupExotelWebSocketServer } = require("./services/exotelWsService");
const { preWarmTTS } = require("./services/ttsService");

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "AI Voicebot Receptionist (Native Exotel WebSocket)",
    wsEndpoint: "/exotel/media",
    health: "healthy",
  });
});

app.use("/exotel", exotelRoutes);
app.use("/api", dataRoutes);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Exotel WebSocket (wss://) Streaming Server
setupExotelWebSocketServer(server);

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[server] AI Voicebot server listening on port ${PORT}`);
      const domain = process.env.BASE_URL
        ? process.env.BASE_URL.replace(/^https?:\/\//, "")
        : "localhost:" + PORT;
      console.log(`[server] Exotel WebSocket Voicebot endpoint: wss://${domain}/exotel/media`);
      preWarmTTS();
    });
  })
  .catch((err) => {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  });
