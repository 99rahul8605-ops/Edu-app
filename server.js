const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const https = require("https");

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEB_URL = process.env.WEB_URL;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !MONGO_URI || !WEB_URL) {
  console.error("Missing env: BOT_TOKEN, MONGO_URI, WEB_URL required hai.");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => { console.error("MongoDB error:", err.message); process.exit(1); });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.status(200).json({
  status: "ok",
  uptime: process.uptime(),
  mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
}));

app.use("/api", require("./routes/course"));

// Owner username frontend ko do
app.get("/api/config", (req, res) => {
  res.json({ ownerUsername: (process.env.OWNER_USERNAME || "").toLowerCase() });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

function clearOldPolling() {
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1&timeout=0`;
    https.get(url, (res) => {
      res.resume();
      res.on("end", resolve);
    }).on("error", resolve);
  });
}

async function startBot() {
  console.log("Purani polling clear kar raha hoon...");
  await clearOldPolling();
  console.log("Clear ho gayi, bot start kar raha hoon...");

  const bot = new TelegramBot(TOKEN, { polling: true });
  const me = await bot.getMe();
  console.log(`Bot started: @${me.username}`);

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `👋 Hello ${msg.from.first_name}!\n\nNeeche button dabao aur saare lectures dekho! 📚`,
      {
        reply_markup: {
          inline_keyboard: [[
            // web_app se Telegram Mini App ke andar khulega
            { text: "📚 Lectures Dekho", web_app: { url: WEB_URL } }
          ]]
        }
      }
    );
  });

  bot.on("polling_error", (err) => console.error("Polling error:", err.message));
  process.on("SIGTERM", () => { bot.stopPolling(); mongoose.connection.close(); process.exit(0); });
  process.on("SIGINT",  () => { bot.stopPolling(); mongoose.connection.close(); process.exit(0); });
}

startBot().catch((err) => {
  console.error("Bot startup error:", err.message);
  process.exit(1);
});
