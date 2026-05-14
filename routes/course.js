const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Batch = require("../models/Course");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "").toLowerCase();

function verifyAdmin(req, res, next) {
  const initData = req.headers["x-tg-init-data"];
  if (!initData) return res.status(401).json({ error: "Unauthorized" });
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");
    const dataCheckString = Array.from(params.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
    const secretKey = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac("sha256",secretKey).update(dataCheckString).digest("hex");
    if (expectedHash !== hash) return res.status(401).json({ error: "Invalid signature" });
    const user = JSON.parse(params.get("user") || "{}");
    if ((user.username||"").toLowerCase() !== OWNER_USERNAME) return res.status(403).json({ error: "Forbidden" });
    next();
  } catch(e) { return res.status(401).json({ error: "Verification failed" }); }
}

// ── Batches ──────────────────────────────────────────────────────────────────
router.get("/batches", async (req, res) => {
  try { res.json(await Batch.find().sort({ order: 1 })); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/batches", verifyAdmin, async (req, res) => {
  try {
    const count = await Batch.countDocuments();
    res.json(await Batch.create({ name: req.body.name, pic: req.body.pic||"", description: req.body.description||"", order: count }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid", verifyAdmin, async (req, res) => {
  try { await Batch.findByIdAndDelete(req.params.bid); res.json({ success: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Subjects ─────────────────────────────────────────────────────────────────
router.post("/batches/:bid/subjects", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    batch.subjects.push({ name: req.body.name, icon: req.body.icon||"📚", color: req.body.color||"#4f8ef7", order: batch.subjects.length });
    await batch.save(); res.json(batch);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    batch.subjects = batch.subjects.filter(s => s._id.toString() !== req.params.sid);
    await batch.save(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Chapters ─────────────────────────────────────────────────────────────────
router.post("/batches/:bid/subjects/:sid/chapters", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    if (!subj) return res.status(404).json({ error: "Not found" });
    subj.chapters.push({ name: req.body.name, order: subj.chapters.length });
    await batch.save(); res.json(batch);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    if (!subj) return res.status(404).json({ error: "Not found" });
    subj.chapters = subj.chapters.filter(c => c._id.toString() !== req.params.cid);
    await batch.save(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Units (optional) ──────────────────────────────────────────────────────────
router.post("/batches/:bid/subjects/:sid/chapters/:cid/units", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.units.push({ name: req.body.name, order: chap.units.length });
    await batch.save(); res.json(batch);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.units = chap.units.filter(u => u._id.toString() !== req.params.uid);
    await batch.save(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Lectures ─────────────────────────────────────────────────────────────────
// Chapter ke seedhe lectures (no unit)
router.post("/batches/:bid/subjects/:sid/chapters/:cid/lectures", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.lectures.push({ name: req.body.name, link: req.body.link, notes: req.body.notes||'', order: chap.lectures.length });
    await batch.save(); res.json(batch);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/lectures/:lid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    if (!chap) return res.status(404).json({ error: "Not found" });
    chap.lectures = chap.lectures.filter(l => l._id.toString() !== req.params.lid);
    await batch.save(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Unit ke andar lectures
router.post("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid/lectures", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    const unit = chap && chap.units.id(req.params.uid);
    if (!unit) return res.status(404).json({ error: "Not found" });
    unit.lectures.push({ name: req.body.name, link: req.body.link, notes: req.body.notes||'', order: unit.lectures.length });
    await batch.save(); res.json(batch);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/batches/:bid/subjects/:sid/chapters/:cid/units/:uid/lectures/:lid", verifyAdmin, async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.bid);
    const subj = batch && batch.subjects.id(req.params.sid);
    const chap = subj && subj.chapters.id(req.params.cid);
    const unit = chap && chap.units.id(req.params.uid);
    if (!unit) return res.status(404).json({ error: "Not found" });
    unit.lectures = unit.lectures.filter(l => l._id.toString() !== req.params.lid);
    await batch.save(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
