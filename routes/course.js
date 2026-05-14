const express = require("express");
const router = express.Router();
const Subject = require("../models/Course");

const ADMIN_PASS = process.env.ADMIN_PASSWORD || "admin123";

function checkAuth(req, res, next) {
  const pass = req.headers["x-admin-password"];
  if (pass !== ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// GET — saare subjects
router.get("/subjects", async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ order: 1 });
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — naya subject
router.post("/subjects", checkAuth, async (req, res) => {
  try {
    const { name, icon, color } = req.body;
    const count = await Subject.countDocuments();
    const subject = await Subject.create({ name, icon, color, order: count });
    res.json(subject);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — subject
router.delete("/subjects/:id", checkAuth, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — chapter
router.post("/subjects/:id/chapters", checkAuth, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    subject.chapters.push({ name: req.body.name, order: subject.chapters.length });
    await subject.save();
    res.json(subject);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — chapter
router.delete("/subjects/:sid/chapters/:cid", checkAuth, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    subject.chapters = subject.chapters.filter(c => c._id.toString() !== req.params.cid);
    await subject.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — lecture
router.post("/subjects/:sid/chapters/:cid/lectures", checkAuth, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    const chapter = subject.chapters.id(req.params.cid);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    chapter.lectures.push({ name: req.body.name, link: req.body.link, order: chapter.lectures.length });
    await subject.save();
    res.json(subject);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — lecture
router.delete("/subjects/:sid/chapters/:cid/lectures/:lid", checkAuth, async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.sid);
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    const chapter = subject.chapters.id(req.params.cid);
    if (!chapter) return res.status(404).json({ error: "Chapter not found" });
    chapter.lectures = chapter.lectures.filter(l => l._id.toString() !== req.params.lid);
    await subject.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
