const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Subject = require("../models/Course");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").toLowerCase();

// Telegram initData verify karo
function verifyTelegramAdmin(req, res, next) {
  const initData = req.headers["x-tg-init-data"];

  if (!initData) return res.status(401).json({ error: "Unauthorized" });

  try {
    // initData parse karo
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");

    // Sorted string banao
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // HMAC verify karo
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (expectedHash !== hash) return res.status(401).json({ error: "Invalid signature" });

    // User check karo
    const user = JSON.parse(params.get("user") || "{}");
    if ((user.username || "").toLowerCase() !== OWNER_USERNAME) {
      return res.status(403).json({ error: "Not authorized" });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "Verification failed" });
  }
}

// GET — public
router.get("/subjects", async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ order: 1 });
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST subject
router.post("/subjects", verifyTelegramAdmin, async (req, res) => {
  try {
    const { name, icon, color } = req.body;
    const count = await Subject.countDocuments();
    const subject = await Subject.create({ name, icon, color, order: count });
    res.json(subject);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE subject
router.delete("/subjects/:id", verifyTelegramAdmin, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST chapter
router.post("/subjects/:id/chapters", verifyTelegramAdmin, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    subject.chapters.push({ name: req.body.name, order: subject.chapters.length });
    await subject.save();
    res.json(subject);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE chapter
router.delete("/subjects/:sid/chapters/:cid", verifyTelegramAdmin, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    subject.chapters = subject.chapters.filter(c => c._id.toString() !== req.params.cid);
    await subject.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST lecture
router.post("/subjects/:sid/chapters/:cid/lectures", verifyTelegramAdmin, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    const chapter = subject.chapters.id(req.params.cid);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    chapter.lectures.push({ name: req.body.name, link: req.body.link, order: chapter.lectures.length });
    await subject.save();
    res.json(subject);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE lecture
router.delete("/subjects/:sid/chapters/:cid/lectures/:lid", verifyTelegramAdmin, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    const chapter = subject.chapters.id(req.params.cid);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    chapter.lectures = chapter.lectures.filter(l => l._id.toString() !== req.params.lid);
    await subject.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
