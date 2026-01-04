import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";
import { Link } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import PreviousMeetings from "./components/PreviousMeetings";
import MeetingDetails from "./components/MeetingDetails";



const API_URL = "http://localhost:5000/api";
let mediaRecorder = null;      // mic recorder
let screenStream = null;       // display stream


export default function App() {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);


  const [meeting, setMeeting] = useState(null);
  const meetingRef = useRef(null);

  const [screenReady, setScreenReady] = useState(false);
  const pendingAutoCapture = useRef(false);   // store urgent capture requests until screen ready
   const screenReadyRef = useRef(false);

  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [keyPoints, setKeyPoints] = useState([]);

  const [ocrText, setOcrText] = useState("");
  const [urgency, setUrgency] = useState("");
  const [importantImages, setImportantImages] = useState([]);
  const [urgentSentences, setUrgentSentences] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);

 // state + ref
const [status, setStatus] = useState("idle");
const statusRef = useRef("idle");
 // "idle" | "recording" | "completed"
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null); // persistent offscreen canvas for capture
  // ---------- TONE DETECTION ----------
const analyserRef = useRef(null);     // reads live audio data
const toneRef = useRef("Calm");       // stores last tone (no re-render)
const [tone, setTone] = useState("Calm"); // shown in UI


  // ---------- Socket setup ----------
useEffect(() => {
  const s = io("http://localhost:5000");
  socketRef.current = s;

  s.on("connect", () => console.log("Socket connected:", s.id));

  s.on("ocr_update", (p) => {
    if (p?.ocrText) setOcrText(old => old ? old + "\n" + p.ocrText : p.ocrText);
  });

  s.on("urgency_update", (p) => {
    if (p?.urgency) setUrgency(p.urgency);
  });
  s.on("request_screen_capture", async () => {
  console.log("📸 Server requested screen capture");
  await captureNow(); // this emits screen_frame
});



s.on("important_image", ({ imageBase64 }) => {
  setImportantImages(prev => {
    if (prev.includes(imageBase64)) return prev;
    return [imageBase64, ...prev];
  });
  
});

  // ✅ FIX: listen ONCE
  s.on("urgent_sentences_detected", (data) => {
    setUrgentSentences(prev => [...prev, ...data.urgentSentences]);
  });
  const id = setInterval(() => {

  // Run only while meeting is active
  if (statusRef.current !== "recording") return;

  const t = detectToneRealtime();

  if (t !== toneRef.current) {
    toneRef.current = t;
    setTone(t);

    // OPTIONAL: inform backend
    if (socketRef.current && meetingRef.current?._id) {
      socketRef.current.emit("tone_update", {
        meetingId: meetingRef.current._id,
        tone: t
      });
    }
  }

}, 5000);


 s.on("meeting_ended", (meeting) => {
  setTranscript(meeting.transcript || "");
  setSummary(meeting.summary || "");
  setKeyPoints(meeting.keyPoints || []);
  setUrgentSentences(meeting.urgentSentences || []);
  setImportantImages(meeting.importantImages || []);
  setOcrText(meeting.ocrText || "");
  setUrgency(meeting.urgency || "Normal");

  // ✅ NOW the meeting is truly ended
  setStatus("completed");
  statusRef.current = "completed";
});


  return () => {
  clearInterval(id);
  s.disconnect();
};

}, []);

  // ---------- Start screen capture ----------
 const startScreen = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",
        logicalSurface: true,
        cursor: "always",
      },
      audio: false
    });

    screenStream = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;

      videoRef.current.onloadeddata = () => {
        console.log("🎥 Screen video READY!");
       setScreenReady(true);
       screenReadyRef.current = true;


        // NOW screen is ready → meeting becomes recording
       setStatus("recording");
       statusRef.current = "recording";   // ⭐ instant update
      };

      try { 
        await videoRef.current.play(); 
      } catch (e) {}
    }

    canvasRef.current = document.createElement("canvas");
    return stream;

  } catch (err) {
    setError("Screen capture failed: " + (err?.message || err));
    return null;
  }
};


  // ---------- Safe auto-capture (wait until everything ready) ----------
  const safeAutoCapture = async () => {
    console.log("⚡ urgent_audio_detected → attempting capture");

    // Wait until everything is ready; loop until true
    let tries = 0;
    while (
      (!screenReadyRef.current ||
       !videoRef.current ||
       !meetingRef.current?._id ||
       !socketRef.current ||
       videoRef.current.readyState < 2) &&
      tries < 20 // limit total wait (20*300ms = 6s)
    ) {
      console.log("⏳ Waiting for video/screen to become ready...");
      console.warn("screenReady:", screenReadyRef.current, "videoRef?", !!videoRef.current, "meetingId?", !!meetingRef.current?._id, "socket?", !!socketRef.current, "video.readyState:", videoRef.current?.readyState);
      await new Promise(r => setTimeout(r, 300));
      tries++;
    }

    if (!videoRef.current || !meetingRef.current?._id || !socketRef.current || videoRef.current.readyState < 2) {
      console.warn("❌ Auto-capture failed: Not ready after wait");
      return;
    }

    console.log("✅ Everything ready → Capturing now!");
    await captureNow();
  };
function detectToneRealtime() {
  const analyser = analyserRef.current;
  if (!analyser) return "Calm";

  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];  // square
  }

  const rms = Math.sqrt(sum / buffer.length); // loudness

  // Threshold logic
  return rms > 0.08 ? "Urgent" : "Calm";
}

  // ---------- Capture Now ----------
  const captureNow = async () => {
    console.log("📸 Capturing frame now...");
    console.log(status);

    if (!videoRef.current || !meetingRef.current?._id || !socketRef.current) {
      setError("Cannot capture: video, meeting, or socket missing.");
      console.warn("captureNow aborted: videoRef?", !!videoRef.current, "meetingId?", meetingRef.current?._id, "socket?", !socketRef.current);
      return;
    }

    const video = videoRef.current;

    if (video.readyState < 2) {
      setError("Screen not ready — switch to your PPT tab and try again.");
      console.warn("captureNow: video.readyState < 2");
      return;
    }

    // short delay so presenter has time to show the content (configurable)
    await new Promise(r => setTimeout(r, 1000));

    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.error("drawImage failed:", err);
      setError("Capture failed. Try again.");
      return;
    }

    const b64 = canvas.toDataURL("image/png");

    if (!b64 || b64.length < 200) {
      setError("Capture error — empty frame received.");
      return;
    }

    try {
      socketRef.current.emit("screen_frame", {
        meetingId: meetingRef.current._id,
        imageBase64: b64
      });
      console.log("📸 Captured and sent frame.");
      setError(null);
    } catch (err) {
      console.warn("emit failed", err);
      setError("Emit failed: " + (err?.message || err));
    }
  };

  // ---------- Microphone recorder ----------
  const startMicRecorder = async () => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      // ---------- REAL-TIME AUDIO ANALYSIS ----------
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const source = audioContext.createMediaStreamSource(mic);
const analyser = audioContext.createAnalyser();

analyser.fftSize = 2048;   // resolution
source.connect(analyser);  // mic → analyser

analyserRef.current = analyser;

      mediaRecorder = new MediaRecorder(mic);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef.current && meetingRef.current?._id) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = reader.result.split(",")[1];
            socketRef.current.emit("audio_chunk", {
              meetingId: meetingRef.current._id,
              b64,
              mimeType: event.data.type,
              status: "chunk"
            });
          };
          reader.readAsDataURL(event.data);
        }
      };
      // chunk size in ms — you can tune this
      mediaRecorder.start(1000);
    } catch (err) {
      console.error("Mic error", err);
      setError("Mic permission denied.");
    }
  };

 const stopRecordings = () => {
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.onstop = () => {
        // 🔴 FINAL AUDIO FLUSH
        socketRef.current?.emit("audio_chunk", {
          meetingId: meetingRef.current?._id,
          b64: "",               // backend will use saved audio file
          mimeType: "audio/webm",
          status: "end"          // ⭐ THIS IS CRITICAL
        });
      };
      mediaRecorder.stop();
    }
  } catch {}

  try { if (screenStream) screenStream.getTracks().forEach(t => t.stop()); } catch {}

  setScreenReady(false);
  pendingAutoCapture.current = false;
};


  const startMeeting = async () => {
  setError(null);
  setTranscript(""); 
  setSummary(""); 
  setKeyPoints([]);
  setOcrText(""); 
  setUrgency(""); 
  setImportantImages([]);

  setStatus("starting"); // temporary

  const res = await fetch(`${API_URL}/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Meeting " + new Date().toLocaleString() })
  });

  const newMeeting = await res.json();
  meetingRef.current = newMeeting;
  setMeeting(newMeeting);
  await startScreen();
  await startMicRecorder();
};


  // ---------- End Meeting ----------
 const endMeeting = async () => {
  stopRecordings();

  if (socketRef.current && meetingRef.current?._id) {
    socketRef.current.emit("end_meeting", {
      meetingId: meetingRef.current._id
    });
  }

  // ❌ DO NOT set status here
  // wait for backend confirmation
};


  // ---------- Render ----------
  return (
  <div className="app">
    <Routes>

      {/* HOME PAGE */}
      <Route path="/" element={
        <>
          <header className="app-header">
            <h1>Meeting Assistant</h1>
            <div>
            {status === "idle" && <button onClick={startMeeting}>Start Meeting</button>}
            {status === "recording" && <button onClick={endMeeting}>End Meeting</button>}
            {status === "completed" && 
              <button onClick={() => { setStatus("idle"); setMeeting(null); meetingRef.current = null; }}>
                Reset
              </button>
            }
            </div>
          </header>

          <div>
            <button>
              <Link to="/previous" style={{textDecoration:"none", color:"white"}}>
                Previous Meetings
              </Link>
            </button>
          </div>

          <video ref={videoRef} autoPlay playsInline muted style={{ display: "none" }} />

          <main>
            {meeting && <h2>{meeting?.title || "No active meeting"}</h2>
}

            {/* <section className="box"><h3>Transcript</h3><pre>{transcript || "Will appear after end..."}</pre></section> */}
            <section className="box"><h3>Summary</h3><p>{summary || "..."}</p></section>
            <section className="box"><h3>Key Points</h3><ul>{keyPoints.map((k,i)=><li key={i}>{k}</li>)}</ul></section>
            {/* <section className="box"><h3>OCR Text</h3><pre>{ocrText || "Extracting on-screen text..."}</pre></section> */}
            <section className="box">
             <h3>Urgent Points</h3>
             <ul>
             {urgentSentences.map((s, i) => (
               <li key={i}>{s}</li>
            ))}

            </ul>
            </section>
           <section className="box">
               <h3>Speaker Tone</h3>
                <p>{tone}</p>
            </section>

          <section className="box">
  <h3>Important Images</h3>

  {importantImages.length > 0 ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {importantImages.map((img, i) => (
        <img
          key={i}
          src={img}
          alt={`important-${i}`}
          style={{
            width: 180,
            borderRadius: 8,
            cursor: "pointer",
            border: "2px solid #eee"
          }}
          onClick={() => setSelectedImage(img)}   // 👈 OPEN
        />
      ))}
    </div>
  ) : (
    "No important images yet..."
  )}
</section>


            {error && <div className="error">{error}</div>}
            {selectedImage && (
  <div
    onClick={() => setSelectedImage(null)}
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0,0,0,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}
  >
    <img
      src={selectedImage}
      alt="Full view"
      style={{
        maxWidth: "90%",
        maxHeight: "90%",
        borderRadius: 10,
        boxShadow: "0 0 20px black"
      }}
      onClick={(e) => e.stopPropagation()} // prevent close when clicking image
    />

    {/* Close button */}
    <button
      onClick={() => setSelectedImage(null)}
      style={{
        position: "absolute",
        top: 20,
        right: 30,
        fontSize: 24,
        background: "transparent",
        color: "white",
        border: "none",
        cursor: "pointer"
      }}
    >
      ✕
    </button>
  </div>
)}

          </main>
        </>
      } />

      {/* OTHER PAGES (No header/UI here) */}
      <Route path="/previous" element={<PreviousMeetings />} />
      <Route path="/meeting/:id" element={<MeetingDetails />} />

    </Routes>
  </div>
);
}
