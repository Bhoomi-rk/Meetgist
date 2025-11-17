

// App.jsx — patched (auto-capture + pending queue + safe start)
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

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

 // state + ref
const [status, setStatus] = useState("idle");
const statusRef = useRef("idle");
 // "idle" | "recording" | "completed"
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null); // persistent offscreen canvas for capture

  // ---------- Socket setup ----------
  useEffect(() => {
    const s = io("http://localhost:5000");
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => console.log("Socket connected:", s.id));

    s.on("meeting_ended", (data) => {
      console.log("meeting_ended", data);
      setTranscript(data.transcript || "");
      setSummary(data.summary || "No summary");
      setKeyPoints(data.keyPoints || []);
      setOcrText(data.ocrText || "");
      setUrgency(data.urgency || "");
      setImportantImages(data.importantImages || []);
      setStatus("idle");
      statusRef.current = "idle";

      stopRecordings();
      // When meeting ends, we don't want pending captures to run
      pendingAutoCapture.current = false;
      setScreenReady(false);

    });

    s.on("ocr_update", (p) => {
      if (p?.ocrText) setOcrText((old) => (old ? old + "\n" + p.ocrText : p.ocrText));
    });

    s.on("urgency_update", (p) => { if (p?.urgency) setUrgency(p.urgency); });

    s.on("important_image", (p) => {
      const img = p?.imageBase64 || p?.url;
      if (!img) return;
      setImportantImages((prev) => {
        if (prev.includes(img)) return prev;
        return [img, ...prev].slice(0, 12);
      });
      console.log("Received important image:", p?.reason || "no reason");
    });

    s.on("summary_update", (data) => {
      if (data.summary) setSummary(data.summary);
      if (data.keyPoints) setKeyPoints(data.keyPoints);
    });

    // Urgent audio from server -> trigger safe auto-capture
   s.on("urgent_audio_detected", () => {
  if (statusRef.current !== "recording") {
    console.log("⚠ Skipping urgent trigger: meeting not recording (status=" + statusRef.current + ")");
    return;
  }

 if (!screenReadyRef.current) {
   pendingAutoCapture.current = true;
   return;
}


  safeAutoCapture();
});


    s.on("connect_error", (err) => console.error("socket connect_error", err));

    return () => {
      try {
        s.off("connect");
        s.off("meeting_ended");
        s.off("ocr_update");
        s.off("urgency_update");
        s.off("important_image");
        s.off("summary_update");
        s.off("urgent_audio_detected");
        s.disconnect();
      } catch (e) {}
    };
    // intentionally leave out dependencies to run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


        // If urgent trigger was waiting, run it now
        // if (pendingAutoCapture.current) {
        //   console.log("⚡ Running delayed urgent auto-capture now!");
        //   pendingAutoCapture.current = false;
        //   safeAutoCapture();
        // }
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
    await new Promise(r => setTimeout(r, 3000));

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
      mediaRecorder = new MediaRecorder(mic);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef.current && meetingRef.current?._id) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = reader.result.split(",")[1];
            socketRef.current.emit("audio_chunk", {
              meetingId: meetingRef.current._id,
              b64,
              mimeType: event.data.type
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
    try { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch {}
    try { if (screenStream) screenStream.getTracks().forEach(t => t.stop()); } catch {}
    // reset screenReady/pending when stopping
    setScreenReady(false);
    pendingAutoCapture.current = false;
  };

  // ---------- Start Meeting ----------
  // const startMeeting = async () => {
  //   setError(null);
  //   setTranscript(""); setSummary(""); setKeyPoints([]);
  //   setOcrText(""); setUrgency(""); setImportantImages([]);

  //   // create meeting in DB
  //   try {
  //     const res = await fetch(`${API_URL}/meetings`, {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ title: "Meeting " + new Date().toLocaleString() })
  //     });
  //     const newMeeting = await res.json();
  //     meetingRef.current = newMeeting;
  //     setMeeting(newMeeting);
  //   } catch (e) {
  //     console.error("create meeting failed", e);
  //     setError("Failed to create meeting");
  //     return;
  //   }

  //   // start screen / mic; status becomes recording only after streams started
  //   await startScreen();
  //   await startMicRecorder();

  //   // only mark recording once streams started (screenReady may be set by onloadeddata)
  //   setStatus("recording");
  //   console.log("🟢 Meeting started (status=recording)");
  // };
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
    if (socketRef.current && meetingRef.current?._id) socketRef.current.emit("end_meeting", { meetingId: meetingRef.current._id });
    setStatus("idle");
statusRef.current = "idle";

  };

  // ---------- Render ----------
  return (
    <div className="app">
      <header className="app-header">
        <h1>Meeting Assistant</h1>
        {status === "idle" && <button onClick={startMeeting}>Start Meeting</button>}
        {status === "recording" && <>
          {/* <button onClick={captureNow} style={{ marginRight: 8 }}>Capture Frame</button> */}
          <button onClick={endMeeting}>End Meeting</button>
        </>}
        {status === "completed" && <button onClick={() => { setStatus("idle"); setMeeting(null); meetingRef.current = null; }}>Reset</button>}
      </header>

      {/* hidden video used for capturing frames */}
      <video ref={videoRef} autoPlay playsInline muted style={{ display: "none" }} />

      <main>
        {meeting && <h2>{meeting.title}</h2>}

        <section className="box"><h3>Transcript</h3><pre>{transcript || "Will appear after end..."}</pre></section>
        <section className="box"><h3>Summary</h3><p>{summary || "..."}</p></section>
        <section className="box"><h3>Key Points</h3><ul>{keyPoints.map((k,i)=><li key={i}>{k}</li>)}</ul></section>

        <section className="box"><h3>OCR Text</h3><pre style={{whiteSpace:"pre-wrap"}}>{ocrText || "Extracting on-screen text..."}</pre></section>

        <section className="box"><h3>Urgency</h3><p style={{color: urgency?.toLowerCase?.().includes("high") ? "red" : "black"}}>{urgency || "Detecting urgency..."}</p></section>

        <section className="box">
          <h3>Important Images</h3>
          {importantImages.length > 0 ? <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
            {importantImages.map((img,i)=>(<img key={i} src={img} alt={`imp-${i}`} style={{width:180,borderRadius:8}} />))}
          </div> : "No important images yet... (press Capture Frame or speak urgent words)"}
        </section>

        {error && <div className="error">{error}</div>}
      </main>
    </div>
  );
}

