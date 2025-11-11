const mongoose = require('mongoose');

const SpeakerSegmentSchema = new mongoose.Schema({
  speaker: String,
  text: String,
  start: Number,
  end: Number,
  confidence: Number
}, { _id: false });

const AudioFeatureSchema = new mongoose.Schema({
  pitch: Number,
  tone: Number,
  speakingRate: Number,
  energy: Number,
  sentiment: String,
  sentimentScore: Number
}, { _id: false });

const VisualFrameSchema = new mongoose.Schema({
  url: String,
  timestamp: Number,
  ocrText: String,
  relevanceScore: Number,
  context: String,
  isScreenshare: Boolean
}, { _id: false });

const Schema = new mongoose.Schema({
  title: String,
  transcript: String,
  source: String,
  date: String,
  summary: String,
  actionItems: [String],
  importantImages: [String],
  urgencyScore: Number,
  status: { type: String, default: 'processing' },
  
  // Multi-modal enhancements
  audioPath: String,
  videoPath: String,
  speakerSegments: [SpeakerSegmentSchema],
  audioFeatures: AudioFeatureSchema,
  visualFrames: [VisualFrameSchema],
  sentiment: String,
  sentimentScore: Number,
  diarization: {
    speakers: [String],
    totalSpeakers: Number
  },
  multimodalSummary: String
}, { timestamps: true });

module.exports = mongoose.model('Meeting', Schema);