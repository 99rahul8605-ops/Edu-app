const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const mongoose = require("mongoose");
const Batch = require("../models/Course");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID || "0");

// ── Admin verification using Telegram initData + OWNER_ID ────────────────────
function verifyAdmin(req, res, next) {
  const initData = req.headers["x-tg-init-data"];
  if (!initData) return res.status(401).json({ error: "Unauthorized" });
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (expectedHash !== hash) return res.status(401).json({ error: "Invalid signature" });
    const user = JSON.parse(params.get("user") || "{}");
    if (user.id !== OWNER_ID) return res.status(403).json({ error: "Forbidden" });
    next();
  } catch (e) {
    return res.status(401).json({ error: "Verification failed" });
  }
}

// ── Helper: check if request is from admin (without blocking) ─────────────────
function isAdminRequest(req) {
  const initData = req.headers["x-tg-init-data"];
  if (!initData) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (expectedHash !== hash) return false;
    const user = JSON.parse(params.get("user") || "{}");
    return user.id === OWNER_ID;
  } catch (e) {
    return false;
  }
}

// ── Batches ───────────────────────────────────────────────────────────────────

router.get("/batches", async (req, res) => {
  try {
    const admin = isAdminRequest(req);
    const filter = admin ? {} : { $or: [{ isPublic: true }, { isPublic: { $exists: false } }] };
    res.json(await Batch.find(filter).sort({ order: 1 }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/batches", verifyAdmin, async (req, res) => {
  try {
    const count = await Batch.countDocuments();
    res.json(await Batch.create({
      name: req.body.name,
      pic: req.body.pic || "",
      description: req.body.description || "",
      order: count,
      isPublic: false,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/batches/:bid/publish", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    batch.isPublic = !batch.isPublic;
    await batch.save();
    res.json({ success: true, isPublic: batch.isPublic });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid", verifyAdmin, async (req, res) => {
  try {
    await Batch.findByIdAndDelete(req.params.bid);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subjects ──────────────────────────────────────────────────────────────────

router.post("/batches/:bid/subjects", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    batch.subjects.push({ name: req.body.name, icon: req.body.icon || "📚", color: req.body.color || "#4f8ef7", order: batch.subjects.length });
    await batch.save();
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    batch.subjects = batch.subjects.filter(s => s._id.toString() !== req.params.sid);
    await batch.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Chapters ──────────────────────────────────────────────────────────────────

router.post("/batches/:bid/subjects/:sid/chapters", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    if (!subj) return res.status(404).json({ error: "Not found" });
    subj.chapters.push({ name: req.body.name, order: subj.chapters.length });
    await batch.save();
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    if (!subj) return res.status(404).json({ error: "Not found" });
    subj.chapters = subj.chapters.filter(c => c._id.toString() !== req.params.cid);
    await batch.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Units ─────────────────────────────────────────────────────────────────────

router.post("/batches/:bid/subjects/:sid/chapters/:cid/units", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.units.push({ name: req.body.name, order: chap.units.length });
    await batch.save();
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.units = chap.units.filter(u => u._id.toString() !== req.params.uid);
    await batch.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lectures (chapter-level) ──────────────────────────────────────────────────

router.post("/batches/:bid/subjects/:sid/chapters/:cid/lectures", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.lectures.push({ name: req.body.name, link: req.body.link, notes: req.body.notes || "", order: chap.lectures.length });
    await batch.save();
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/lectures/:lid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.lectures = chap.lectures.filter(l => l._id.toString() !== req.params.lid);
    await batch.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lectures (unit-level) ─────────────────────────────────────────────────────

router.post("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid/lectures", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    const unit = chap && chap.units.id(req.params.uid);
    if (!unit) return res.status(404).json({ error: "Not found" });
    unit.lectures.push({ name: req.body.name, link: req.body.link, notes: req.body.notes || "", order: unit.lectures.length });
    await batch.save();
    res.json(batch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid/lectures/:lid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    const unit = chap && chap.units.id(req.params.uid);
    if (!unit) return res.status(404).json({ error: "Not found" });
    unit.lectures = unit.lectures.filter(l => l._id.toString() !== req.params.lid);
    await batch.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;


// ── Ad Token Schema ───────────────────────────────────────────────────────────
const crypto = require("crypto");

const adTokenSchema = new mongoose.Schema({
  userId:   { type: String, required: true },
  token:    { type: String, required: true, unique: true },
  issuedAt: { type: Date, default: Date.now },
  expiresAt:{ type: Date, required: true },
});
adTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const AdToken = mongoose.model("AdToken", adTokenSchema);

// ── Access Schema ─────────────────────────────────────────────────────────────
const accessSchema = new mongoose.Schema({
  userId:   { type: String, required: true, unique: true },
  expiresAt:{ type: Date, required: true },
});
accessSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Access = mongoose.model("Access", accessSchema);

// Check access
router.get("/access/:userId", async (req, res) => {
  try {
    const record = await Access.findOne({ userId: req.params.userId });
    if (!record || record.expiresAt < new Date()) return res.json({ hasAccess: false, expiresAt: null });
    res.json({ hasAccess: true, expiresAt: record.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Step 1: Issue one-time token before showing ad
router.post("/access/token/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const existing = await Access.findOne({ userId });
    if (existing && existing.expiresAt > new Date()) {
      return res.json({ hasAccess: true, expiresAt: existing.expiresAt });
    }
    await AdToken.deleteMany({ userId });
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await AdToken.create({ userId, token, expiresAt });
    res.json({ token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Step 2: Claim access with token (min 15s after issuance)
router.post("/access/claim/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });
    const record = await AdToken.findOne({ userId, token });
    if (!record) return res.status(403).json({ error: "Invalid or expired token. Ad dobara dekho." });
    if (record.expiresAt < new Date()) return res.status(403).json({ error: "Token expired. Ad dobara dekho." });
    const elapsed = (Date.now() - new Date(record.issuedAt)) / 1000;
    if (elapsed < 15) return res.status(403).json({ error: "Ad poori nahi dekhi. Ruko..." });
    await AdToken.deleteOne({ _id: record._id });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await Access.findOneAndUpdate(
      { userId },
      { userId, expiresAt },
      { upsert: true, new: true }
    );
    res.json({ hasAccess: true, expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
