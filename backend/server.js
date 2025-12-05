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

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// MongoDB (fallback to local)
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/meetgist";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err?.message || err));

const Meeting = mongoose.model("Meeting", {
  title: String,
  startedAt: Date,
  endedAt: Date,
  transcript: String,
  summary: String,
  keyPoints: [String],
  ocrText: String,
  urgency: String,
  urgentAudioWords: [String],
  importantImages: [String], // store base64 frames (trimmed)
});

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
    "urgent", "important", "submit", "deadline", "asap",
    "immediately", "must", "tonight", "slide",
    "priority", "emergency", "critical"
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

//
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

// ---------------- SOCKETS ----------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("audio_chunk", async ({ meetingId, b64, mimeType, status }) => {
    if (!meetingId || !b64) return;

    try {
      const file = saveChunk(meetingId, b64, mimeType);

      // 🔥 LIVE TRANSCRIPTION FOR URGENT WORDS
      const text = await transcribe(file); // Whisper STT for this chunk

      if (text && text.trim().length > 0) {
        const words = extractUrgentAudioWords(text);

        if (words.length > 0) {
          console.log("🔥 URGENT AUDIO DETECTED:", words);
          socket.emit("urgent_audio_detected", { meetingId, words });

          // --- NEW: when urgent audio detected, save the latest screen frame as important ---
          try {
            const frame = lastScreenFrame[meetingId];
            if (frame) {
              const m = await Meeting.findById(meetingId);
              if (m) {
                m.importantImages = m.importantImages || [];
                m.importantImages.unshift(frame);
                if (m.importantImages.length > 8) m.importantImages = m.importantImages.slice(0, 8);
                // optionally record which audio words triggered it
                m.urgentAudioWords = Array.from(new Set([...(m.urgentAudioWords || []), ...words]));
                m.urgency = "High";
                await m.save();
              }

              socket.emit("important_image", {
                meetingId,
                imageBase64: frame,
                reason: "urgent_audio_detected",
                words
              });
            }
          } catch (e) {
            console.error("saving frame on urgent audio failed:", e);
          }
        }

        // Append transcript continuously
        const m = await Meeting.findById(meetingId);
        if (m) {
          m.transcript = (m.transcript || "") + " " + text;
          await m.save();
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
        m.ocrText = (m.ocrText || "") + (m.ocrText ? "\n" : "") + ocrText;
        await m.save();
        socket.emit("ocr_update", { meetingId, ocrText });
      }

      // urgency
      const combined = (((m.transcript || "") + "\n" + (m.ocrText || "")).trim());
      const urgencyLabel = await analyzeUrgency(combined);
      if (urgencyLabel) {
        m.urgency = urgencyLabel;
        await m.save();
        socket.emit("urgency_update", { meetingId, urgency: urgencyLabel });
      }

      // ----- AUTO SUMMARY AFTER EACH MANUAL CAPTURE -----
      if (GROQ_KEY) {
        try {
          const combinedText = ((m.transcript || "") + "\n" + (m.ocrText || "")).trim();

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

            // SAVE
            m.summary = summary;
            m.keyPoints = keyPoints;
            await m.save();

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
    m.transcript = (m.transcript || "") + " " + (finalText || "");

    // Generate Final Summary
    if (GROQ_KEY && m.transcript?.length > 10) {
      const summaryRes = await fetch(`${GROQ_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization:`Bearer ${GROQ_KEY}`,"Content-Type":"application/json" },
        body: JSON.stringify({
          model:"llama-3.1-8b-instant",
          messages:[
            { role:"system", content:"Summarize concisely." },
            { role:"user", content:`Summarize meeting:\n${m.transcript}` }
          ]
        })
      });
      const js = await summaryRes.json();
      m.summary = js?.choices?.[0]?.message?.content || "No summary";
    }

    // Generate Key Points
    if (GROQ_KEY && m.transcript?.length > 10) {
      const keysRes = await fetch(`${GROQ_URL}/chat/completions`,{
        method:"POST",
        headers:{ Authorization:`Bearer ${GROQ_KEY}`,"Content-Type":"application/json" },
        body:JSON.stringify({
          model:"llama-3.1-8b-instant",
          messages:[
            { role:"system", content:"Extract 5 key bullet points" },
            { role:"user", content:m.transcript }
          ]
        })
      });
      const json = await keysRes.json();
      m.keyPoints = (json?.choices?.[0]?.message?.content || "")
        .split("\n")
        .map(v=>v.replace(/^[-*•\s]*/,"").trim())
        .filter(Boolean)
        .slice(0,5);
    }

    m.endedAt = new Date();
    await m.save();

    socket.emit("meeting_ended", m);
    console.log("✔ Meeting saved successfully");

  } catch(e){
    console.log("end_meeting error",e);
  }
});

});
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
app.get("/api/meetings", async (req,res)=>{
  const data = await Meeting.find({}, "title createdAt summary")
                            .sort({createdAt:-1});
  res.json(data);
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
// app.delete("/api/meetings/clear", async (req,res)=>{
//    try {
//     const result = await Meeting.deleteMany({});
//     res.json({ message: "All meetings deleted", deletedCount: result.deletedCount || 0 });
//   } catch (err) {
//     console.error("clear meetings error:", err?.message || err);
//     res.status(500).json({ error: "failed to delete meetings" });
// +  }
// });


app.get("/api/meetings", async (req, res) => {
  try {
    const items = await Meeting.find().sort({ createdAt: -1 }).limit(50);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: "failed to list meetings" });
  }
});

server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
