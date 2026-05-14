const mongoose = require("mongoose");

const lectureSchema = new mongoose.Schema({
  name: { type: String, required: true },
  link: { type: String, required: true },
  order: { type: Number, default: 0 },
});

const chapterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  order: { type: Number, default: 0 },
  lectures: [lectureSchema],
});

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  icon: { type: String, default: "📚" },
  color: { type: String, default: "#4f8ef7" },
  order: { type: Number, default: 0 },
  chapters: [chapterSchema],
});

module.exports = mongoose.model("Subject", subjectSchema);
