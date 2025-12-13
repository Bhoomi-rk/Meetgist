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

function extractUrgentAudioWords(text) {
  if (!text) return [];

  const urgentKeywords = [
     "important","note this","slide","important point","remember","pay attention","graph","chart"
  ];

  const found = [];
  const lower = text.toLowerCase();

  urgentKeywords.forEach(k => {
    if (new RegExp(`\\b${k}\\b`, "i").test(lower)) found.push(k);
  });

  return Array.from(new Set(found));
}

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
const lastImageSave = {};

// ---------------- SOCKETS ----------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ---- STT throttling per socket to reduce Groq rate-limit errors ----
  let lastSTT = 0;
  const STT_GAP = 500; // ms between transcribe calls

  socket.on("audio_chunk", async ({ meetingId, b64, mimeType, status }) => {
    if (!meetingId || !b64) return;

    try {
      const file = saveChunk(meetingId, b64, mimeType);

      // Throttle STT calls to avoid rate limit
      if (Date.now() - lastSTT < STT_GAP) {
        // Still attempt minimal transcript append locally by skipping STT call
        return;
      }
      lastSTT = Date.now();

      // 🔥 LIVE TRANSCRIPTION FOR URGENT WORDS
      const text = await transcribe(file); // Whisper STT for this chunk

      if (text && text.trim().length > 0) {
        const words = extractUrgentAudioWords(text);

        if (words.length > 0) {
          console.log("🔥 URGENT AUDIO DETECTED:", words);
          socket.emit("urgent_audio_detected", { meetingId, words });

          // --- when urgent audio detected, save the latest screen frame as important ---
          try {
            const frame = lastScreenFrame[meetingId];
            if (frame) {
              // Use atomic updates (no .save()) to avoid VersionError
             // ========== FIX 3: Prevent duplicate image spam ==========
            const now = Date.now();

          if (!lastImageSave[meetingId] || now - lastImageSave[meetingId] > 8000) {

           await Meeting.findByIdAndUpdate(
              meetingId,
           {
            $addToSet: { importantImages: frame },  // prevents duplicates
           $addToSet: { urgentAudioWords: { $each: words } },
           urgency: "High"
         },
        { new: true, upsert: true }
      );

     lastImageSave[meetingId] = now;

  socket.emit("important_image", {
    meetingId,
    imageBase64: frame,
    reason: "urgent_audio_detected",
    words
  });
}


          
            }
          } catch (e) {
            console.error("saving frame on urgent audio failed:", e);
          }
        }

        // Append transcript continuously (compute new transcript safely and update using findByIdAndUpdate)
        try {
          const m = await Meeting.findById(meetingId);
          if (m) {
            const newTranscript = ((m.transcript || "").trim() + " " + text).trim();
            await Meeting.findByIdAndUpdate(
              meetingId,
              { transcript: newTranscript },
              { new: true, upsert: true }
            );
          }
        } catch (err) {
          console.error("transcript append error:", err?.message || err);
        }
      }
    } catch (err) {
      console.error("audio_chunk error:", err?.message || err);
    }
  });

  const lastProcessed = {};

  socket.on("screen_frame", async ({ meetingId, imageBase64 }) => {
    try {
      if (!meetingId || !imageBase64) return;

      // store latest frame for this meeting so audio-triggered saves can use it
      lastScreenFrame[meetingId] = imageBase64; // <-- ADDED

      const now = Date.now();
      if (lastProcessed[meetingId] && (now - lastProcessed[meetingId] < 900)) return;
      lastProcessed[meetingId] = now;

      console.log("Received screen frame:", meetingId);

      const m = await Meeting.findById(meetingId);
      if (!m) {
        console.warn("Meeting not found for frame:", meetingId);
        return;
      }

      // OCR
      let ocrText = await runOCR(imageBase64);

      // CLEAN the OCR output
      ocrText = cleanOCR(ocrText);

      if (ocrText) {
        // compute new ocrText string and update atomically
        const newOcr = ((m.ocrText || "").trim() + (m.ocrText ? "\n" : "") + ocrText).trim();
        try {
          await Meeting.findByIdAndUpdate(
            meetingId,
            { ocrText: newOcr },
            { new: true, upsert: true }
          );
          socket.emit("ocr_update", { meetingId, ocrText });
        } catch (e) {
          console.error("ocr update failed:", e);
        }
      }

      // urgency: analyze combined transcript + ocrText (read latest from DB)
      try {
        const fresh = await Meeting.findById(meetingId);
        const combined = (((fresh?.transcript || "") + "\n" + (fresh?.ocrText || "")).trim());
        const urgencyLabel = await analyzeUrgency(combined);
        if (urgencyLabel) {
          await Meeting.findByIdAndUpdate(
            meetingId,
            { urgency: urgencyLabel },
            { new: true }
          );
          socket.emit("urgency_update", { meetingId, urgency: urgencyLabel });
        }
      } catch (e) {
        console.error("urgency update failed:", e);
      }

      // ----- AUTO SUMMARY AFTER EACH MANUAL CAPTURE -----
      if (GROQ_KEY) {
        try {
          const fresh = await Meeting.findById(meetingId);
          const combinedText = ((fresh?.transcript || "") + "\n" + (fresh?.ocrText || "")).trim();

          if (combinedText.length > 20) {

            // CREATE SUMMARY
            const res = await fetch(`${GROQ_URL}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                  { role: "system", content: "Summarize meetings concisely." },
                  { role: "user", content: `Summarize:\n${combinedText}` }
                ],
                temperature: 0.3
              })
            });

            const json = await res.json();
            const summary = json?.choices?.[0]?.message?.content || "";

            // CREATE KEY POINTS
            const keyObj = await fetch(`${GROQ_URL}/chat/completions`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${GROQ_KEY}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                  { role: "system", content: "Extract 5 bullet points." },
                  { role: "user", content: combinedText }
                ],
                temperature: 0.15
              })
            });

            const keyJSON = await keyObj.json();
            const keyPoints = (keyJSON?.choices?.[0]?.message?.content || "")
              .split(/\n/)
              .map(x => x.replace(/^[-*•\s]*/, "").trim())
              .filter(Boolean)
              .slice(0, 5);

            // SAVE (atomic update)
            await Meeting.findByIdAndUpdate(
              meetingId,
              { summary, keyPoints },
              { new: true, upsert: true }
            );

            // SEND LIVE UPDATE TO FRONTEND
            socket.emit("summary_update", { summary, keyPoints });
          }
        } catch (err) {
          console.error("summary_update error:", err);
        }
      }
    } catch (err) {
      console.error("screen_frame handler error:", err?.message || err);
    }
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
      if (GROQ_KEY && newTranscript?.length > 10) {
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
