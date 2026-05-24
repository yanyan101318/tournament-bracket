require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

const isDev = process.env.NODE_ENV !== "production";

function loadSendSmsHandler() {
  const handlerPath = path.resolve(__dirname, "api", "send-sms.js");
  if (isDev) {
    delete require.cache[handlerPath];
  }
  return require(handlerPath);
}

app.post("/api/send-sms", async (req, res) => {
  try {
    const sendSmsHandler = loadSendSmsHandler();
    await sendSmsHandler(req, res);
  } catch (e) {
    console.error("Local Server Error:", e);
    res.status(500).json({ error: "Server logic error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Local API Server running on http://127.0.0.1:${PORT}`);
  if (isDev) {
    console.log("SMS API reloads on each request (development mode).");
  }
  const mask = process.env.M360_SHORTCODE_MASK || process.env.M360_SENDER_ID || "";
  if (!String(mask).trim()) {
    console.warn(
      "WARNING: M360_SHORTCODE_MASK is not set — SMS will fail until you add your m360 sender ID to .env"
    );
  }
});
