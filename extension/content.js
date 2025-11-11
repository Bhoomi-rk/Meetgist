// content.js — injected into Google Meet
// Multi-modal meeting capture with audio recording

console.log("✅ MeetGist content script active on", window.location.href);

// Audio recorder instance
let audioRecorder = null;
let meetingStartTime = null;
let transcriptBuffer = [];
let isRecording = false;

// Initialize audio recorder
function initAudioRecorder() {
  // Load audio recorder (inline for content script)
  if (typeof AudioRecorder !== 'undefined') {
    audioRecorder = new AudioRecorder();
  } else {
    // Fallback: create simple recorder
    audioRecorder = {
      async startRecording() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const recorder = new MediaRecorder(stream);
          const chunks = [];
          
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
          };
          
          recorder.start();
          return { recorder, chunks, stream };
        } catch (error) {
          console.error("❌ Audio recording not available:", error);
          return null;
        }
      }
    };
  }
}

// Function to capture captions or spoken text with timestamps
function captureCaptions() {
  const captions = [];
  const nodes = document.querySelectorAll('[class*="caption"], [data-self-name], [data-speaker-id]');
  
  nodes.forEach(node => {
    const text = node.innerText?.trim();
    if (text && !captions.includes(text)) {
      captions.push({
        text: text,
        timestamp: Date.now(),
        speaker: node.getAttribute('data-speaker-name') || 'Unknown'
      });
    }
  });
  
  return captions;
}

// Collect transcript periodically during meeting
function startTranscriptCollection() {
  const interval = setInterval(() => {
    const newCaptions = captureCaptions();
    transcriptBuffer.push(...newCaptions);
    console.log(`📝 Collected ${newCaptions.length} caption segments`);
  }, 5000); // Collect every 5 seconds

  // Store interval ID for cleanup
  window.meetgistTranscriptInterval = interval;
}

// Stop transcript collection
function stopTranscriptCollection() {
  if (window.meetgistTranscriptInterval) {
    clearInterval(window.meetgistTranscriptInterval);
    window.meetgistTranscriptInterval = null;
  }
}

// Start meeting recording
async function startMeetingRecording() {
  if (isRecording) {
    console.log("⚠️ Recording already in progress");
    return;
  }

  console.log("🎬 Starting meeting recording...");
  meetingStartTime = Date.now();
  isRecording = true;
  
  // Start transcript collection
  startTranscriptCollection();
  
  // Try to start audio recording (requires user permission)
  try {
    if (audioRecorder) {
      const started = await audioRecorder.startRecording();
      if (started) {
        console.log("✅ Audio recording started");
      }
    }
  } catch (error) {
    console.warn("⚠️ Could not start audio recording:", error);
    console.log("💡 Audio recording requires user permission. Meeting will be saved with transcript only.");
  }
}

// Stop meeting recording and save
async function stopMeetingRecording() {
  if (!isRecording) {
    return;
  }

  console.log("🛑 Stopping meeting recording...");
  isRecording = false;
  stopTranscriptCollection();

  // Collect final transcript
  const finalCaptions = captureCaptions();
  transcriptBuffer.push(...finalCaptions);

  // Combine transcript
  const transcriptText = transcriptBuffer.map(c => c.text).join(" ");
  const transcript = transcriptBuffer.length > 0 ? transcriptText : "";

  // Stop audio recording
  let audioBlob = null;
  if (audioRecorder && audioRecorder.isRecording) {
    const audioData = await audioRecorder.stopRecording();
    if (audioData) {
      audioBlob = audioData.blob;
      console.log(`✅ Audio recording stopped: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`);
    }
  }

  // Prepare meeting data
  const meetingData = {
    title: document.title.replace(" - Google Meet", "") || "Google Meet Session",
    transcript: transcript,
    source: "google-meet",
    date: new Date().toISOString(),
    duration: meetingStartTime ? (Date.now() - meetingStartTime) / 1000 : 0
  };

  console.log("📤 Sending meeting data to backend...");
  console.log(`   Transcript: ${transcript.length} characters`);
  console.log(`   Audio: ${audioBlob ? 'Yes' : 'No'}`);

  try {
    // Create FormData for file upload
    const formData = new FormData();
    formData.append('transcript', meetingData.transcript);
    formData.append('source', meetingData.source);
    formData.append('date', meetingData.date);
    formData.append('title', meetingData.title);

    if (audioBlob) {
      formData.append('audio', audioBlob, `meeting-${Date.now()}.webm`);
    }

    // Send to backend
    const response = await fetch("http://localhost:5000/api/saveMeeting", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ Meeting saved:", result);

    // Notify background script
    chrome.runtime.sendMessage({ 
      type: "MEETING_SAVED", 
      data: result 
    });

    // Reset buffers
    transcriptBuffer = [];
    meetingStartTime = null;

  } catch (error) {
    console.error("❌ Error saving meeting:", error);
    chrome.runtime.sendMessage({ 
      type: "MEETING_SAVE_ERROR", 
      error: error.message 
    });
  }
}

// Detect when user joins meeting (heuristic: check for video/audio buttons)
function detectMeetingStart() {
  const checkInterval = setInterval(() => {
    const meetingElements = document.querySelectorAll('[data-is-muted], [aria-label*="microphone"], [aria-label*="camera"]');
    if (meetingElements.length > 0 && !isRecording) {
      console.log("🎥 Meeting detected, starting recording...");
      startMeetingRecording();
      clearInterval(checkInterval);
    }
  }, 2000);

  // Stop checking after 30 seconds
  setTimeout(() => clearInterval(checkInterval), 30000);
}

// Detect when user leaves the meeting
window.addEventListener("beforeunload", async () => {
  if (isRecording) {
    await stopMeetingRecording();
  }
});

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    startMeetingRecording();
    sendResponse({ success: true });
  } else if (message.type === "STOP_RECORDING") {
    stopMeetingRecording().then(() => {
      sendResponse({ success: true });
    });
    return true; // Async response
  } else if (message.type === "GET_RECORDING_STATUS") {
    sendResponse({
      isRecording: isRecording,
      transcriptLength: transcriptBuffer.length,
      duration: meetingStartTime ? (Date.now() - meetingStartTime) / 1000 : 0
    });
  }
});

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAudioRecorder();
    detectMeetingStart();
  });
} else {
  initAudioRecorder();
  detectMeetingStart();
}

// Auto-start recording when meeting is detected
detectMeetingStart();
