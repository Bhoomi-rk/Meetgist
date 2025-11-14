// server.js – FULLY FIXED FOR GROQ
require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const FormData = require("form-data");

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1";

if (!GROQ_KEY) console.log("❌ Missing GROQ_API_KEY");

// ----------------- SERVER -----------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ----------------- MONGO -----------------
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/meetgist")
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

const Meeting = mongoose.model("Meeting", {
  title: String,
  startedAt: Date,
  endedAt: Date,
  transcript: String,
  summary: String,
  keyPoints: [String],
});

// ----------------- AUDIO HELPERS -----------------
function mimeToExt(m) {
  if (!m) return "webm";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

const TMP = path.join(__dirname, "tmp_audio");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);

function saveChunk(id, b64, mime) {
  const ext = mimeToExt(mime);
  const file = path.join(TMP, `${id}.${ext}`);
  fs.appendFileSync(file, Buffer.from(b64, "base64"));
  return file;
}

// ----------------- GROQ: Whisper STT -----------------
async function transcribe(filePath) {

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("model", "whisper-large-v3");

  const res = await fetch(`${GROQ_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: form
  });

  const json = await res.json();
  console.log("STT:", json);

  return json.text || "";
}

// ----------------- GROQ: SUMMARY -----------------

async function summarize(text) {
  const res = await fetch(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
       model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You summarize meeting transcripts clearly." },
        { role: "user", content: `Summarize the following meeting in 5 sentences:\n\n${text}` }
      ],
      temperature: 0.2,
      max_tokens: 300
    })
  });

  const json = await res.json();

  console.log("SUMMARY RESPONSE:", json); // <-- REQUIRED DEBUG LINE

  return json.choices?.[0]?.message?.content || "No summary";
}



async function extractPoints(text) {
  const res = await fetch(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
       model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "You extract key action points." },
        { role: "user", content: `Extract 5 bullet points:\n\n${text}` }
      ],
      temperature: 0.1,
      max_tokens: 200
    })
  });

  const json = await res.json();

  console.log("KEYPOINTS RESPONSE:", json); // <-- REQUIRED DEBUG LINE

  return json.choices?.[0]?.message?.content
    ?.split("\n")
    .map(p => p.replace(/^[-*•]\s*/, "").trim())
    .filter(p => p.length > 0)
    .slice(0, 5);
}



// ----------------- SOCKETS -----------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("audio_chunk", ({ meetingId, b64, mimeType }) => {
    saveChunk(meetingId, b64, mimeType);
  });

  socket.on("end_meeting", async ({ meetingId }) => {
    const m = await Meeting.findById(meetingId);
    if (!m) return;

    // find file
    const exts = ["webm", "mp3", "wav", "ogg"];
    let file = null;
    for (const e of exts) {
      const f = path.join(TMP, `${meetingId}.${e}`);
      if (fs.existsSync(f)) file = f;
    }

    const text = file ? await transcribe(file) : "";
    m.transcript = text;

    m.summary = await summarize(text);
    m.keyPoints = await extractPoints(text);
    m.endedAt = new Date();

    await m.save();

    socket.emit("meeting_ended", m);
  });

  socket.on("disconnect", () =>
    console.log("Disconnected:", socket.id)
  );
});

// ----------------- ROUTES -----------------
app.post("/api/meetings", async (req, res) => {
  const m = await Meeting.create({
    title: req.body.title,
    startedAt: new Date()
  });
  res.json(m);
});

// ----------------- RUN -----------------
server.listen(5000, () =>
  console.log("🚀 Server running at http://localhost:5000")
);
server.js
