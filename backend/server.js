require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const os = require("os");

// node-fetch dynamic import helper (works in CommonJS)
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const FormData = require("form-data");

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1";
const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] },
});

app.use(cors({
  origin: "http://localhost:5173",
  methods: ["GET","POST","DELETE"]
}));
app.use(express.json());

// MongoDB (fallback to local)
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/meetgist";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err?.message || err));

// Optional safety: disable optimistic concurrency globally (reduces VersionErrors further)


// -------------------------
// Meeting Schema (FIXED)
// -------------------------
// Important: versionKey: false must be inside the same options object as timestamps.
const Meeting = mongoose.model("Meeting", new mongoose.Schema({
  title: { type: String, required: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  transcript: String,      // keeping as String (you chose option A)
  summary: String,
  keyPoints: [String],
  ocrText: String,         // keeping as String
  urgency: { type: String, default: "Normal" },
  urgentAudioWords: [String],
  urgentSentences: [String],
  importantImages: [String],
}, { 
  timestamps: true,
  versionKey: false          // <-- FIXED (now honored)
}));

// tmp audio directory
const TMP = path.join(__dirname, "tmp_audio");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

let detrPipeline = null;

(async () => {
  try {
    const { pipeline } = require("@xenova/transformers");
    console.log("Loading DETR model...");
    detrPipeline = await pipeline("object-detection", "Xenova/detr-resnet-50");
    console.log("DETR model loaded.");
  } catch (err) {
    console.error("❌ DETR load error:", err);
    detrPipeline = null;
  }
})();

// store latest screen frame for each meeting (used when urgent audio is detected)
const lastScreenFrame = {}; // <-- ADDED

// Helpers
function mimeToExt(m) {
  if (!m) return "webm";
  m = m.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}



function saveChunk(id, b64, mime) {
  const ext = mimeToExt(mime);
  const file = path.join(TMP, `${id}.${ext}`);
  fs.appendFileSync(file, Buffer.from(b64, "base64"));
  return file;
}

const TEXT_URGENCY = [
  "must", "deadline", "tomorrow", "submit",
  "complete", "asap", "required", "important task"
];
const VISUAL_URGENCY = [
  "slide", "graph", "chart", "diagram", "figure"
];
// Detect urgent words in text
function detectTextUrgency(text) {
  if (!text) return false;
  return TEXT_URGENCY.some(k => text.toLowerCase().includes(k));
}
// Detect visual urgency from text (placeholder, can be improved)
function detectVisualUrgency(text) {
  if (!text) return false;
  return VISUAL_URGENCY.some(k => text.toLowerCase().includes(k));
}


function safeBase64ToBuffer(base64) {
  if (!base64 || typeof base64 !== "string") return null;
  const m = base64.match(/^data:image\/\w+;base64,(.*)$/);
  const raw = m ? m[1] : base64;
  try {
    return Buffer.from(raw, "base64");
  } catch (e) {
    return null;
  }
}
// Detect urgent words in text
function extractUrgentSentences(text) {
  if (!text) return [];

  // urgency keywords
  const urgencyPatterns = [
    /important/i,
    /must/i,
    /has to/i,
    /need to/i,
    /deadline/i,
    /tomorrow/i,
    /by today/i,
    /asap/i,
    /urgent/i,
    /submit/i,
    /complete/i
  ];

  // split into sentences
  const sentences = text
    .split(/[.?!]/)
    .map(s => s.trim())
    .filter(Boolean);

  // keep only urgent ones
  return sentences.filter(sentence =>
    urgencyPatterns.some(pattern => pattern.test(sentence))
  );
}
//------------------------------------------------------------

// ---------------- GROQ: Whisper STT ----------------
async function transcribe(filePath) {
  if (!GROQ_KEY) {
    console.warn("GROQ_KEY missing — skipping STT");
    return "";
  }

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-large-v3");

    const res = await fetch(`${GROQ_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: form,
    });

    const json = await res.json();
    console.log("STT JSON:", json?.x_groq?.id ? "ok" : json);

    return json?.text || "";
  } catch (err) {
    console.error("Transcribe error:", err?.message || err);
    return "";
  }
}

function cleanOCR(text) {
  if (!text) return "";

  return text
    // Remove URLs
    .replace(/https?:\/\/\S+/gi, "")
    // Remove Google Meet toolbar text
    .replace(/is sharing your screen/gi, "")
    .replace(/stop sharing/gi, "")
    .replace(/on google meet/gi, "")
    .replace(/meet gist popup/gi, "")
    .replace(/presentation \.pptx/gi, "")
    .replace(/ashmitha u.*/gi, "")
    // Remove buttons
    .replace(/\b(hide|share tab|close|presenting)\b/gi, "")
    // Remove timestamps
    .replace(/\b\d{1,2}:\d{2}\b/g, "")
    // Remove long OneDrive IDs
    .replace(/[a-zA-Z0-9]{15,}/g, "")
    // Remove special junk symbols
    .replace(/[^\w\s.,!?]/g, "")
    // Remove extra spaces
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------- OCR ----------------
async function runOCR(imageBase64) {
  try {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const sharp = require("sharp");
    const processed = await sharp(buffer)
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();

    const result = await Tesseract.recognize(processed, "eng");
    console.log(result);

    return (result?.data?.text || "").trim();
  } catch (err) {
    console.error("OCR error:", err);
    return "";
  }
}

// ---------------- Urgency ----------------
async function analyzeUrgency(combinedText) {
  try {
    const text = (combinedText || "").trim();
    if (!text) return "No text detected";

    const lower = text.toLowerCase();
    if (/(urgent|asap|immediately|important|deadline|must|required)/i.test(lower)) {
      return "High";
    }

    return "Normal";
  } catch (err) {
    console.error("analyzeUrgency error:", err?.message || err);
    return "Normal";
  }
}

// ---------------- Important image detection ----------------
// (left commented as you had it; keep if you want OCR+DETR-based detection later)
// async function detectImportantImage(imageBase64, ocrText) { ... }
// prevent duplicate image spam
// Prevent repeated importantImages saving spam

// ====== GLOBALS (ADD ONCE) ======
const activeTranscription = {};
const lastImageSave = {};
const lastVisualCapture = {};
const IMPORTANT_GAP = 15000; // 15 seconds

// ---------------- SOCKETS ----------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ---- STT throttling per socket to reduce Groq rate-limit errors ----
  let lastSTT = 0;
  const STT_GAP = 3000; // ms between transcribe calls
  // ADD near top (globals)

 socket.on("audio_chunk", async ({ meetingId, b64, mimeType, status }) => {
  if (!meetingId || !b64) return;

  const file = saveChunk(meetingId, b64, mimeType);

  // ✅ ONLY final audio triggers STT + urgency
 

  if (activeTranscription[meetingId]) return;
  activeTranscription[meetingId] = true;

  let text = "";
  try {
    text = await transcribe(file);
   
  } finally {
    setTimeout(() => delete activeTranscription[meetingId], 3000);
  }

  if (!text) return;
 
  // ---------- TEXT URGENCY ----------
  if (detectTextUrgency(text)) {
    const urgentSentences = extractUrgentSentences(text);

    if (urgentSentences.length) {
      await Meeting.findByIdAndUpdate(
        meetingId,
        { $addToSet: { urgentSentences: { $each: urgentSentences } }, urgency: "High" }
      );
      socket.emit("urgent_sentences_detected", { meetingId, urgentSentences });
    }
  }

  // ---------- VISUAL URGENCY ----------
  if (detectVisualUrgency(text)) {
  const now = Date.now();

  if (
    !lastVisualCapture[meetingId] ||
    now - lastVisualCapture[meetingId] > VISUAL_CAPTURE_GAP
  ) {
    lastVisualCapture[meetingId] = now;

    console.log("⚡ Visual urgency detected → requesting screen capture");

    socket.emit("request_screen_capture", {
      meetingId,
      reason: "visual_urgency"
    });
  } else {
    console.log("⏳ Visual urgency detected, but capture skipped (cooldown)");
  }
}


  // ---------- TRANSCRIPT ----------
  const m = await Meeting.findById(meetingId);
  const newTranscript = ((m?.transcript || "") + " " + text).trim();
  await Meeting.findByIdAndUpdate(meetingId, { transcript: newTranscript });
});

  const lastProcessed = {};

 socket.on("screen_frame", async ({ meetingId, imageBase64 }) => {
  lastScreenFrame[meetingId] = imageBase64;

  await Meeting.findByIdAndUpdate(
    meetingId,
    { $addToSet: { importantImages: imageBase64 }, urgency: "High" }
  );

  socket.emit("important_image", {
    meetingId,
    imageBase64,
    reason: "visual_urgency"
  });
});


  socket.on("end_meeting", async ({ meetingId }) => {
    try {
      const m = await Meeting.findById(meetingId);
      if (!m) return;

      // Final transcript update from last recorded audio file
      const exts = ["webm", "mp3", "wav", "ogg"];
      let file = null;

      for (const e of exts) {
        const f = path.join(TMP, `${meetingId}.${e}`);
        if (fs.existsSync(f)) { file = f; break; }
      }

      const finalText = file ? await transcribe(file) : m.transcript;
      const newTranscript = ((m.transcript || "").trim() + " " + (finalText || "")).trim();

      // Prepare fields to update
      const updatePayload = { transcript: newTranscript, endedAt: new Date() };

      // Generate Final Summary
      if (GROQ_KEY && newTranscript) {
        try {
          const summaryRes = await fetch(`${GROQ_URL}/chat/completions`, {
            method: "POST",
            headers: { Authorization:`Bearer ${GROQ_KEY}`,"Content-Type":"application/json" },
            body: JSON.stringify({
              model:"llama-3.1-8b-instant",
              messages:[
                { role:"system", content:"Summarize concisely." },
                { role:"user", content:`Summarize meeting:\n${newTranscript}` }
              ]
            })
          });
          const js = await summaryRes.json();
          updatePayload.summary = js?.choices?.[0]?.message?.content || "No summary";
        } catch (e) {
          console.error("final summary error:", e);
        }
      }

      // Generate Key Points
      if (GROQ_KEY && newTranscript?.length > 10) {
        try {
          const keysRes = await fetch(`${GROQ_URL}/chat/completions`,{
            method:"POST",
            headers:{ Authorization:`Bearer ${GROQ_KEY}`,"Content-Type":"application/json" },
            body:JSON.stringify({
              model:"llama-3.1-8b-instant",
              messages:[
                { role:"system", content:"Extract 5 key bullet points" },
                { role:"user", content:newTranscript }
              ]
            })
          });
          const json = await keysRes.json();
          updatePayload.keyPoints = (json?.choices?.[0]?.message?.content || "")
            .split("\n")
            .map(v=>v.replace(/^[-*•\s]*/,"").trim())
            .filter(Boolean)
            .slice(0,5);
        } catch (e) {
          console.error("final keypoints error:", e);
        }
      }
   


      // Atomic update to save final fields
      const saved = await Meeting.findByIdAndUpdate(
        meetingId,
        updatePayload,
        { new: true, upsert: true }
      );

      socket.emit("meeting_ended", saved);
      console.log("✔ Meeting saved successfully");

    } catch(e){
      console.log("end_meeting error",e);
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
  });

});
 // end io.on

// REST
app.post("/api/meetings", async (req, res) => {
  try {
    const m = await Meeting.create({
      title: req.body.title || "Meeting " + new Date().toLocaleString(),
      startedAt: new Date(),
      ocrText: "",
      urgency: "Normal",
      importantImages: [],
    });

    res.json(m);
  } catch (err) {
    console.error("create meeting error:", err?.message || err);
    res.status(500).json({ error: "failed to create meeting" });
  }
});
// GET all meetings

app.get("/api/meetings", async (req, res) => {
  try {
    const items = await Meeting.find().sort({ createdAt: -1 }).limit(50);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "failed to list meetings" });
  }
});

// GET single meeting
app.get("/api/meetings/:id", async (req,res)=>{
  const meeting = await Meeting.findById(req.params.id);
  res.json(meeting);
});

// DELETE meeting
app.delete("/api/meetings/:id", async (req,res)=>{
  await Meeting.findByIdAndDelete(req.params.id);
  res.json({message:"deleted"});
});

// DELETE all meetings
app.delete("/api/meetings/delete/all", async (req, res) => {
  try {
    const result = await Meeting.deleteMany({});
    return res.json({
      success: true,
      deleted: result.deletedCount,
      message: "All meetings deleted successfully"
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete" });
  }
});

server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
