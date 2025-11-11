// Audio Recorder Module for MeetGist Extension
// Captures audio from Google Meet using MediaRecorder API

class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.stream = null;
    this.startTime = null;
  }

  async startRecording() {
    try {
      console.log("🎤 Starting audio recording...");
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        }
      });

      this.stream = stream;
      this.audioChunks = [];
      this.isRecording = true;
      this.startTime = Date.now();

      // Create MediaRecorder
      const options = {
        mimeType: 'audio/webm;codecs=opus'
      };

      // Fallback to default if webm not supported
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/webm';
      }

      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          console.log(`📦 Audio chunk received: ${event.data.size} bytes`);
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error("❌ MediaRecorder error:", event.error);
      };

      this.mediaRecorder.onstop = () => {
        console.log("⏹️ Recording stopped");
        this.stream.getTracks().forEach(track => track.stop());
      };

      // Start recording
      this.mediaRecorder.start(1000); // Collect data every second
      console.log("✅ Audio recording started");

      return true;
    } catch (error) {
      console.error("❌ Error starting audio recording:", error);
      this.isRecording = false;
      return false;
    }
  }

  async stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) {
      return null;
    }

    try {
      return new Promise((resolve) => {
        this.mediaRecorder.onstop = () => {
          const duration = (Date.now() - this.startTime) / 1000;
          console.log(`📊 Recording duration: ${duration.toFixed(2)}s`);
          console.log(`📦 Total chunks: ${this.audioChunks.length}`);

          // Create blob from chunks
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          console.log(`💾 Audio blob size: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`);

          this.isRecording = false;
          this.audioChunks = [];
          
          resolve({
            blob: audioBlob,
            duration: duration,
            mimeType: 'audio/webm'
          });
        };

        this.mediaRecorder.stop();
        this.stream.getTracks().forEach(track => track.stop());
      });
    } catch (error) {
      console.error("❌ Error stopping recording:", error);
      return null;
    }
  }

  getRecordingStatus() {
    return {
      isRecording: this.isRecording,
      duration: this.isRecording ? (Date.now() - this.startTime) / 1000 : 0
    };
  }
}

// Alternative: Capture audio from tab (requires tabCapture permission)
async function captureTabAudio(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.capture({
      audio: true,
      video: false
    }, (stream) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!stream) {
        reject(new Error("Failed to capture tab audio"));
        return;
      }

      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        resolve(audioBlob);
      };

      resolve({
        recorder: mediaRecorder,
        stream: stream
      });
    });
  });
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AudioRecorder, captureTabAudio };
}

