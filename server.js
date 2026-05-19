const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const WEB_URL = process.env.WEB_URL;
const PORT = process.env.PORT || 3000;
const OWNER_ID = parseInt(process.env.OWNER_ID || "0"); // Telegram numeric user ID

if (!TOKEN || !MONGO_URI || !WEB_URL || !OWNER_ID) {
  console.error("Missing env: BOT_TOKEN, MONGO_URI, WEB_URL, OWNER_ID are required.");
  process.exit(1);
}

// ── Helper: is this user the owner? ─────────────────────────────────────────
function isOwner(userId) {
  return userId === OWNER_ID;
}

// ── MongoDB connect ──────────────────────────────────────────────────────────
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => { console.error("MongoDB error:", err.message); process.exit(1); });

// ─── Schemas ─────────────────────────────────────────────────────────────────

// File Store schemas
const fileSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  file_id: { type: String, required: true },
  file_type: { type: String, required: true },
  file_name: { type: String, default: "file" },
  uploaded_by: { type: Number },
  expires_at: { type: Date, default: null },
  delivered_to: [{ type: Number }],
  created_at: { type: Date, default: Date.now },
});
fileSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expires_at: { $type: "date" } } }
);
const FileRecord = mongoose.model("FileRecord", fileSchema);

const bulkBatchSchema = new mongoose.Schema({
  batch_code: { type: String, required: true, unique: true, index: true },
  user_id: { type: Number, required: true },
  files: [
    {
      file_id:   { type: String, required: true },
      file_type: { type: String, required: true },
      file_name: { type: String, default: "file" },
    }
  ],
  created_at: { type: Date, default: Date.now },
});
const BulkBatch = mongoose.model("BulkBatch", bulkBatchSchema);

const pendingDeleteSchema = new mongoose.Schema({
  chat_id:    { type: Number, required: true },
  message_id: { type: Number, required: true },
  delete_at:  { type: Date,   required: true },
});
const PendingDelete = mongoose.model("PendingDelete", pendingDeleteSchema);

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/health", (req, res) => res.status(200).json({
  status: "ok",
  uptime: process.uptime(),
  mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
}));

app.get("/api/config", (req, res) => {
  res.json({ ownerId: OWNER_ID });
});

app.use("/api", require("./routes/course"));

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ─── File Store Helpers ───────────────────────────────────────────────────────

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function getUniqueCode() {
  let code, exists;
  do {
    code = generateCode();
    exists = await FileRecord.findOne({ code });
  } while (exists);
  return code;
}

async function getUniqueBatchCode() {
  let code, exists;
  do {
    code = "B" + generateCode();
    exists = await BulkBatch.findOne({ batch_code: code });
  } while (exists);
  return code;
}

function extractFileInfo(msg) {
  if (msg.document)   return { file_id: msg.document.file_id,  file_type: "document",   file_name: msg.document.file_name || "document" };
  if (msg.photo)      return { file_id: msg.photo[msg.photo.length - 1].file_id, file_type: "photo", file_name: "photo.jpg" };
  if (msg.video)      return { file_id: msg.video.file_id,      file_type: "video",      file_name: msg.video.file_name || "video.mp4" };
  if (msg.audio)      return { file_id: msg.audio.file_id,      file_type: "audio",      file_name: msg.audio.file_name || "audio.mp3" };
  if (msg.voice)      return { file_id: msg.voice.file_id,      file_type: "voice",      file_name: "voice.ogg" };
  if (msg.video_note) return { file_id: msg.video_note.file_id, file_type: "video_note", file_name: "video_note.mp4" };
  return null;
}

async function sendFile(bot, chatId, record) {
  const caption = `📎 ${record.file_name}`;
  switch (record.file_type) {
    case "photo":      return await bot.sendPhoto(chatId, record.file_id, { caption });
    case "video":      return await bot.sendVideo(chatId, record.file_id, { caption, protect_content: true });
    case "audio":      return await bot.sendAudio(chatId, record.file_id, { caption });
    case "voice":      return await bot.sendVoice(chatId, record.file_id, { caption });
    case "video_note": return await bot.sendVideoNote(chatId, record.file_id, { protect_content: true });
    default:           return await bot.sendDocument(chatId, record.file_id, { caption });
  }
}

// In-memory bulk sessions: { userId: { files: [...], chatId, timer } }
const bulkSessions = new Map();
const BULK_TIMEOUT_MS = 5 * 60 * 1000;

async function wait(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function scheduleDelete(bot, chatId, messageId, deleteAt) {
  await PendingDelete.create({ chat_id: chatId, message_id: messageId, delete_at: deleteAt });
  const delay = Math.max(0, deleteAt - Date.now());
  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, messageId);
      await PendingDelete.deleteOne({ chat_id: chatId, message_id: messageId });
    } catch (err) {
      console.error("Auto DM deletion error:", err.message);
      await PendingDelete.deleteOne({ chat_id: chatId, message_id: messageId }).catch(() => {});
    }
  }, delay);
}

async function recoverPendingDeletes(bot) {
  const pending = await PendingDelete.find({});
  console.log(`Recovering ${pending.length} pending DM deletions...`);
  for (const p of pending) {
    const delay = Math.max(0, new Date(p.delete_at) - Date.now());
    setTimeout(async () => {
      try {
        await bot.deleteMessage(p.chat_id, p.message_id);
      } catch (err) {
        console.error("Recovered deletion error:", err.message);
      }
      await PendingDelete.deleteOne({ _id: p._id }).catch(() => {});
      await FileRecord.updateMany({}, { $pull: { delivered_to: p.chat_id } }).catch(() => {});
    }, delay);
  }
}

// ─── Bot startup ──────────────────────────────────────────────────────────────

async function startBot() {
  // Clear old polling
  try {
    console.log("Clearing old polling...");
    const res = await fetch(
      `https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1&timeout=0`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) console.warn("getUpdates response:", res.status);
  } catch (err) {
    console.warn("getUpdates skip (network issue):", err.message);
  }

  // Bot init with retry
  let bot;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      bot = new TelegramBot(TOKEN, {
        polling: { interval: 2000, autoStart: false, params: { timeout: 30 } },
      });
      await bot.getMe();
      break;
    } catch (err) {
      console.error(`Bot init attempt ${attempt} failed: ${err.message}`);
      if (attempt === 5) throw err;
      await wait(5000 * attempt);
    }
  }

  bot.startPolling();
  const me = await bot.getMe();
  const BOT_USERNAME = me.username;
  console.log(`Bot started: @${BOT_USERNAME}`);

  // ── Set Web App menu button ────────────────────────────────────────────────
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        menu_button: {
          type: "web_app",
          text: "Open EduBot",
          web_app: { url: WEB_URL },
        },
      }),
    });
    console.log("Menu button set:", WEB_URL);
  } catch (err) {
    console.warn("Failed to set menu button:", err.message);
  }

  await recoverPendingDeletes(bot);

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const param = match[1].trim();

    // File/batch link delivery — works for everyone
    if (param) {
      if (param.startsWith("B")) {
        // Bulk batch
        try {
          const batch = await BulkBatch.findOne({ batch_code: param });
          if (!batch) return bot.sendMessage(chatId, `File not found. Link may be invalid or expired.`);
          for (const f of batch.files) {
            await sendFile(bot, chatId, f);
          }
          return;
        } catch (err) {
          console.error("Batch deep link error:", err.message);
          return bot.sendMessage(chatId, `Error occurred. Please try again.`);
        }
      }

      // Single file
      try {
        const record = await FileRecord.findOne({ code: { $regex: new RegExp(`^${param}$`, "i") } });
        if (!record) return bot.sendMessage(chatId, `File not found. Link may be invalid or expired.`);

        const isVideo = record.file_type === "video" || record.file_type === "video_note";

        if (isVideo && record.delivered_to.includes(chatId)) {
          return bot.sendMessage(chatId, `⚠️ This video has already been delivered to you. It will be auto-deleted from your DM within 24 hours of first delivery.`);
        }

        const sentMsg = await sendFile(bot, chatId, record);

        if (isVideo) {
          const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await scheduleDelete(bot, chatId, sentMsg.message_id, deleteAt);
          await FileRecord.updateOne({ _id: record._id }, { $addToSet: { delivered_to: chatId } });
          setTimeout(async () => {
            await FileRecord.updateOne({ _id: record._id }, { $pull: { delivered_to: chatId } }).catch(() => {});
          }, 24 * 60 * 60 * 1000);
          await bot.sendMessage(chatId, `⚠️ This video will be automatically deleted from your DM after 24 hours.`);
        }
      } catch (err) {
        console.error("Deep link error:", err.message);
        bot.sendMessage(chatId, `Error occurred. Please try again.`);
      }
      return;
    }

    // No param — Web App button for everyone
    const welcomeText = isOwner(userId)
      ? `👋 Hello Admin!\n\nTap the button below to browse all lectures! 📚\n\n` +
        `📁 File Store Commands:\n` +
        `/bulk — start bulk upload mode\n` +
        `/myfiles — view your saved files\n` +
        `/delete <code> — delete a file\n` +
        `/cancel — cancel bulk mode`
      : `👋 Hello ${msg.from.first_name}!\n\nTap the button below to browse all lectures! 📚`;

    bot.sendMessage(chatId, welcomeText, {
      reply_markup: {
        inline_keyboard: [[
          { text: "📚 Browse Lectures", web_app: { url: WEB_URL } }
        ]]
      }
    });
  });

  // ─── File Store Commands (Owner Only — silent ignore for others) ─────────────

  // ── /bulk ────────────────────────────────────────────────────────────────────
  bot.onText(/\/bulk/, async (msg) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;

    if (bulkSessions.has(userId)) {
      return bot.sendMessage(chatId,
        `⚠️ Bulk mode is already active!\nSend files or use /done to complete.\nTo cancel use /cancel.`
      );
    }

    const timer = setTimeout(async () => {
      if (bulkSessions.has(userId)) {
        bulkSessions.delete(userId);
        try {
          await bot.sendMessage(chatId, `⏰ Bulk session timed out (5 min). Start again with /bulk.`);
        } catch (_) {}
      }
    }, BULK_TIMEOUT_MS);

    bulkSessions.set(userId, { files: [], chatId, timer });

    bot.sendMessage(chatId,
      `📦 Bulk mode ON!\n\nSend files one by one.\nWhen done, type /done — you will get a single shareable link!\n\n❌ Cancel: /cancel`
    );
  });

  // ── /done ────────────────────────────────────────────────────────────────────
  bot.onText(/\/done/, async (msg) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;
    const session = bulkSessions.get(userId);

    if (!session) {
      return bot.sendMessage(chatId, `No active bulk session. Start one with /bulk.`);
    }
    if (session.files.length === 0) {
      return bot.sendMessage(chatId, `⚠️ No files sent yet! Send files first, then use /done.`);
    }

    clearTimeout(session.timer);
    bulkSessions.delete(userId);

    const processing = await bot.sendMessage(chatId, `⏳ Saving batch...`);
    try {
      const batchCode = await getUniqueBatchCode();
      await BulkBatch.create({ batch_code: batchCode, user_id: userId, files: session.files });

      const link = `https://t.me/${BOT_USERNAME}?start=${batchCode}`;
      await bot.deleteMessage(chatId, processing.message_id);

      const fileList = session.files.map((f, i) => `${i + 1}. ${f.file_name}`).join("\n");
      await bot.sendMessage(chatId,
        `✅ Batch ready! ${session.files.length} files saved.\n\n📋 Files:\n${fileList}\n\nShare this link — all files will be delivered at once:`,
        { reply_markup: { inline_keyboard: [[{ text: "📥 Saari Files Lo", url: link }]] } }
      );
      await bot.sendMessage(chatId, link, { disable_web_page_preview: true });
    } catch (err) {
      console.error("Batch save error:", err.message);
      try {
        await bot.editMessageText(`Batch could not be saved. Please try again.`, {
          chat_id: chatId, message_id: processing.message_id
        });
      } catch (_) {
        bot.sendMessage(chatId, `Batch could not be saved. Please try again.`);
      }
    }
  });

  // ── /cancel ──────────────────────────────────────────────────────────────────
  bot.onText(/\/cancel/, async (msg) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;
    const session = bulkSessions.get(userId);

    if (!session) {
      return bot.sendMessage(chatId, `No active bulk session.`);
    }
    clearTimeout(session.timer);
    bulkSessions.delete(userId);
    bot.sendMessage(chatId,
      `❌ Bulk session cancelled.${session.files.length > 0 ? ` (${session.files.length} files discarded)` : ""}`
    );
  });

  // ── /myfiles ─────────────────────────────────────────────────────────────────
  bot.onText(/\/myfiles/, async (msg) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;
    try {
      const files = await FileRecord.find({ uploaded_by: userId }).sort({ created_at: -1 }).limit(20);
      const batches = await BulkBatch.find({ user_id: userId }).sort({ created_at: -1 }).limit(10);

      if (files.length === 0 && batches.length === 0) {
        return bot.sendMessage(chatId, `No files or batches uploaded yet.`);
      }

      const emoji = { document: "📄", photo: "🖼️", video: "🎬", audio: "🎵", voice: "🎤", video_note: "📹" };
      let text = "";

      if (files.length > 0) {
        text += `📁 Single Files (${files.length}):\n\n`;
        files.forEach((f) => {
          text += `${emoji[f.file_type] || "📎"} ${f.file_name}\nhttps://t.me/${BOT_USERNAME}?start=${f.code}\n\n`;
        });
      }
      if (batches.length > 0) {
        text += `📦 Bulk Batches (${batches.length}):\n\n`;
        batches.forEach((b) => {
          text += `🗂️ Batch (${b.files.length} files) — ${b.created_at.toLocaleDateString("en-IN")}\nhttps://t.me/${BOT_USERNAME}?start=${b.batch_code}\n\n`;
        });
      }

      bot.sendMessage(chatId, text, { disable_web_page_preview: true });
    } catch (err) {
      bot.sendMessage(chatId, `An error occurred. Please try again.`);
    }
  });

  // ── /delete <code> ───────────────────────────────────────────────────────────
  bot.onText(/\/delete (.+)/, async (msg, match) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;
    const code = match[1].trim();
    try {
      const record = await FileRecord.findOneAndDelete({
        code: { $regex: new RegExp(`^${code}$`, "i") },
        uploaded_by: userId,
      });
      if (record) return bot.sendMessage(chatId, `✅ File deleted successfully!`);

      const batch = await BulkBatch.findOneAndDelete({
        batch_code: { $regex: new RegExp(`^${code}$`, "i") },
        user_id: userId,
      });
      if (batch) return bot.sendMessage(chatId, `✅ Batch deleted! (${batch.files.length} files)`);

      bot.sendMessage(chatId, `Code not found or it does not belong to you.`);
    } catch (err) {
      bot.sendMessage(chatId, `Deletion failed. Please try again.`);
    }
  });

  // ── Telegram message link fetch (Owner only) ─────────────────────────────────
  const TG_LINK_RE = /https?:\/\/t\.me\/(c\/(\d+)|([a-zA-Z][a-zA-Z0-9_]{3,}))\/(\d+)/;

  bot.onText(TG_LINK_RE, async (msg, match) => {
    const userId = msg.from?.id;
    if (!isOwner(userId)) return; // Silent ignore

    const chatId = msg.chat.id;
    const isPrivate = !!match[2];
    const rawId     = match[2];
    const username  = match[3];
    const messageId = parseInt(match[4], 10);
    const fromChatId = isPrivate ? parseInt(`-100${rawId}`, 10) : `@${username}`;

    const processing = await bot.sendMessage(chatId, `⏳ Fetching file from link...`);
    try {
      const forwarded = await bot.forwardMessage(chatId, fromChatId, messageId);
      const fileInfo  = extractFileInfo(forwarded);

      if (!fileInfo) {
        await bot.deleteMessage(chatId, forwarded.message_id).catch(() => {});
        return bot.editMessageText(
          `⚠️ No file found in that message.\n(Only documents, photos, videos, and audio are supported)`,
          { chat_id: chatId, message_id: processing.message_id }
        );
      }

      await bot.deleteMessage(chatId, forwarded.message_id).catch(() => {});

      const session = bulkSessions.get(userId);
      if (session) {
        session.files.push(fileInfo);
        const count = session.files.length;
        return bot.editMessageText(
          `✅ File ${count} added to bulk: ${fileInfo.file_name}\n📦 Total: ${count} file(s)\n\nSend more files/links or type /done to get the link.`,
          { chat_id: chatId, message_id: processing.message_id }
        );
      }

      const code = await getUniqueCode();
      await FileRecord.create({
        code, file_id: fileInfo.file_id, file_type: fileInfo.file_type,
        file_name: fileInfo.file_name, uploaded_by: userId, expires_at: null,
      });
      const link = `https://t.me/${BOT_USERNAME}?start=${code}`;
      await bot.deleteMessage(chatId, processing.message_id);
      await bot.sendMessage(chatId, `✅ ${fileInfo.file_name}\n\nClick the link below to receive the file:`,
        { reply_markup: { inline_keyboard: [[{ text: "📥 File Lo", url: link }]] } }
      );
      await bot.sendMessage(chatId, link, { disable_web_page_preview: true });

    } catch (err) {
      console.error("Link fetch error:", err.message);
      const errText =
        err.message.includes("chat not found") || err.message.includes("CHAT_ADMIN_REQUIRED")
          ? `❌ Bot is not a member of that group/channel.\nPlease add the bot there first.`
        : err.message.includes("MESSAGE_ID_INVALID") || err.message.includes("not found")
          ? `❌ Message not found. Is the link correct?`
        : err.message.includes("PEER_ID_INVALID")
          ? `❌ Cannot access this group/channel.\nPlease make the bot a member there.`
        : `❌ Error: ${err.message}`;
      try {
        await bot.editMessageText(errText, { chat_id: chatId, message_id: processing.message_id });
      } catch (_) { bot.sendMessage(chatId, errText); }
    }
  });

  // ── File upload handler (Owner only) ────────────────────────────────────────
  bot.on("message", async (msg) => {
    if (msg.text && TG_LINK_RE.test(msg.text)) return; // Already handled above
    if (msg.text) return; // Text messages ignore
    if (!isOwner(msg.from?.id)) return; // Silent ignore for non-owner

    const chatId  = msg.chat.id;
    const userId  = msg.from?.id;
    const fileInfo = extractFileInfo(msg);
    if (!fileInfo) return;

    const session = bulkSessions.get(userId);
    if (session) {
      session.files.push(fileInfo);
      const count = session.files.length;
      await bot.sendMessage(chatId,
        `✅ File ${count} added: ${fileInfo.file_name}\n📦 Total: ${count} file(s)\n\nSend more files or type /done to get the link.`,
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    const processing = await bot.sendMessage(chatId, `⏳ Saving file...`);
    try {
      const code = await getUniqueCode();
      await FileRecord.create({
        code, file_id: fileInfo.file_id, file_type: fileInfo.file_type,
        file_name: fileInfo.file_name, uploaded_by: userId, expires_at: null,
      });
      const link = `https://t.me/${BOT_USERNAME}?start=${code}`;
      await bot.deleteMessage(chatId, processing.message_id);
      await bot.sendMessage(chatId, `✅ ${fileInfo.file_name}\n\nClick the link below to receive the file:`,
        { reply_markup: { inline_keyboard: [[{ text: "📥 File Lo", url: link }]] } }
      );
      await bot.sendMessage(chatId, link, { disable_web_page_preview: true });
    } catch (err) {
      console.error("Save error:", err.message);
      try {
        await bot.editMessageText(`File could not be saved. Please try again.`, {
          chat_id: chatId, message_id: processing.message_id
        });
      } catch (_) { bot.sendMessage(chatId, `File could not be saved. Please try again.`); }
    }
  });

  // ── Polling error ────────────────────────────────────────────────────────────
  bot.on("polling_error", (err) => console.error("Polling error:", err.message));

  process.on("SIGTERM", () => { bot.stopPolling(); mongoose.connection.close(); process.exit(0); });
  process.on("SIGINT",  () => { bot.stopPolling(); mongoose.connection.close(); process.exit(0); });
}

startBot().catch((err) => {
  console.error("Bot startup error:", err.message);
  process.exit(1);
});
