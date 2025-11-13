// App.jsx – WORKING WITH GROQ BACKEND
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_URL = "http://localhost:5000/api";

let mediaRecorder = null;
let screenStream = null;

export default function App() {
  const [socket, setSocket] = useState(null);

  const [meeting, setMeeting] = useState(null);
  const meetingRef = useRef(null);

  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [keyPoints, setKeyPoints] = useState([]);

  const [status, setStatus] = useState("idle"); // idle | recording | completed
  const [error, setError] = useState(null);

  const videoRef = useRef(null);

  useEffect(() => {
    const s = io("http://localhost:5000");
    setSocket(s);

    s.on("connect", () => console.log("Socket connected:", s.id));

    // When server finishes summary + key points
    s.on("meeting_ended", (data) => {
      console.log("Meeting ended:", data);

      setTranscript(data.transcript || "");
      setSummary(data.summary || "No summary");
      setKeyPoints(data.keyPoints || []);

      setStatus("completed");
      stopRecordings();
    });

    return () => s.disconnect();
  }, []);

  // Start screen capture (Google Meet tab)
  const startScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // IMPORTANT: captures Google Meet audio
      });

      screenStream = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      console.log("Screen capture tracks:", stream.getAudioTracks());
      return stream;
    } catch (err) {
      setError("Screen share failed: " + err.message);
      return null;
    }
  };

  // Start mic recording (for clear speech audio)
  const startMicRecorder = async () => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

      mediaRecorder = new MediaRecorder(mic);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket && meetingRef.current?._id) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(",")[1];
            const mime = event.data.type;

            // Send audio chunk to server
            socket.emit("audio_chunk", {
              meetingId: meetingRef.current._id,
              b64: base64,
              mimeType: mime,
            });
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(1000); // send every second
    } catch (err) {
      console.error("Mic error:", err);
      setError("Microphone permission denied.");
    }
  };

  // Stop everything
  const stopRecordings = () => {
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    } catch {}

    try {
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
      }
    } catch {}
  };

  // Start meeting
  const startMeeting = async () => {
    try {
      setError(null);
      setTranscript("");
      setSummary("");
      setKeyPoints([]);

      // 1. Create meeting in DB
      const res = await fetch(`${API_URL}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Meeting " + new Date().toLocaleString(),
        }),
      });

      const newMeeting = await res.json();
      meetingRef.current = newMeeting;
      setMeeting(newMeeting);

      // 2. Start capture
      await startScreen();
      await startMicRecorder();

      setStatus("recording");
    } catch (err) {
      console.error("Start meeting error:", err);
      setError("Error starting meeting");
    }
  };

  const endMeeting = async () => {
    stopRecordings();

    if (socket && meetingRef.current?._id) {
      socket.emit("end_meeting", { meetingId: meetingRef.current._id });
    }

    setStatus("completed");
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Meeting Assistant</h1>

        {status === "idle" && (
          <button onClick={startMeeting}>Start Meeting</button>
        )}

        {status === "recording" && (
          <button onClick={endMeeting}>End Meeting</button>
        )}
      </header>

      {/* Hidden Google Meet Preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: "none" }}
      />

      <main>
        {meeting && <h2>{meeting.title}</h2>}

        <section className="box">
          <h3>Live Transcript</h3>
          <p>
            {status === "completed"
              ? transcript || "No transcript"
              : "Recording... transcript will appear after meeting ends."}
          </p>
        </section>

        <section className="box">
          <h3>Summary</h3>
          <p>{summary || "Summary will appear after meeting ends..."}</p>
        </section>

        <section className="box">
          <h3>Key Points</h3>
          {keyPoints.length > 0 ? (
            <ul>
              {keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          ) : (
            "Key points will appear after meeting ends..."
          )}
        </section>

        {error && <div className="error">{error}</div>}
      </main>
    </div>
  );
}
