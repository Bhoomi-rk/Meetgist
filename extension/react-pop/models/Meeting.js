const mongoose = require("mongoose");

const MeetingSchema = new mongoose.Schema({
  title: String,
  startedAt: Date,
  endedAt: Date,
  transcript: { type: String, default: "" },
  summary: { type: String, default: "" },
  keyPoints: { type: [String], default: [] },
  ocrText: { type: String, default: "" },
  urgency: { type: String, default: "Normal" },
  urgentAudioWords: [String],
  importantImages: [String], // base64 images stored
}, { timestamps: true });

module.exports = mongoose.model("Meeting", MeetingSchema);
