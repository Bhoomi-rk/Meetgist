import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_URL = 'http://localhost:5000/api';
let mediaRecorder = null;
let audioChunks = [];
let screenStream = null;
let summaryInterval = null;

function App() {
  const [meeting, setMeeting] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);
  const [meetingStatus, setMeetingStatus] = useState('idle');
  const [socket, setSocket] = useState(null);
  const [transcript, setTranscript] = useState('');
  const videoRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    console.log('Initializing socket connection...');
    const newSocket = io('http://localhost:5000');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to socket server');
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setError('Failed to connect to the server');
    });

    newSocket.on('transcript', (data) => {
      console.log('Received transcript:', data);
      setTranscript(prev => prev + ' ' + data.text);
    });

    newSocket.on('summary_update', (data) => {
      console.log('Received summary update:', data);
      setMeeting(prev => ({
        ...prev,
        summary: data.summary || prev?.summary,
        keyPoints: data.keyPoints || prev?.keyPoints || []
      }));
    });

    newSocket.on('meeting_ended', (data) => {
      console.log('Meeting ended with data:', data);
      setMeeting(prev => ({
        ...prev,
        ...data,
        endedAt: new Date().toISOString()
      }));
      setMeetingStatus('completed');
      stopRecordings();
    });

    return () => {
      console.log('Cleaning up socket connection');
      if (newSocket) newSocket.disconnect();
    };
  }, []);

  // Start screen sharing
  const startScreenShare = async () => {
    console.log('Starting screen share...');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      console.log('Screen share started successfully');
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      screenStream = stream;
      return stream;
    } catch (err) {
      console.error('Error accessing screen share:', err);
      setError('Failed to access screen sharing: ' + err.message);
      return null;
    }
  };

  // Start audio recording
  const startAudioRecording = async () => {
    console.log('Starting audio recording...');
    try {
      console.log('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted');

      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        console.log('Audio data available:', event.data.size, 'bytes');
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
      };

      mediaRecorder.onerror = (error) => {
        console.error('MediaRecorder error:', error);
        setError('Error recording audio: ' + error.message);
      };

      mediaRecorder.start(1000); // Get chunks every second
      console.log('MediaRecorder started');
      
      return mediaRecorder;

    } catch (err) {
      console.error('Error starting audio recording:', err);
      setError('Microphone access denied: ' + err.message);
      return null;
    }
  };

  // Send audio chunks to server
  const startSendingAudio = () => {
    if (!mediaRecorder || !socket || !meeting?._id) {
      console.error('Cannot start sending audio: mediaRecorder, socket, or meeting ID not available');
      return;
    }
    
    console.log('Starting to send audio chunks...');
    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        console.log('Sending audio chunk of size:', event.data.size, 'bytes');
        try {
          const arrayBuffer = await event.data.arrayBuffer();
          socket.emit('audio_chunk', {
            meetingId: meeting._id,
            chunk: Array.from(new Uint8Array(arrayBuffer))
          });
        } catch (error) {
          console.error('Error processing audio chunk:', error);
        }
      }
    };
  };

  // Stop all recordings
  const stopRecordings = () => {
    console.log('Stopping recordings...');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.log('Stopping media recorder...');
      mediaRecorder.stop();
      mediaRecorder = null;
    }
    
    if (screenStream) {
      console.log('Stopping screen stream...');
      screenStream.getTracks().forEach(track => {
        console.log('Stopping track:', track.kind);
        track.stop();
      });
      screenStream = null;
    }

    if (summaryInterval) {
      console.log('Clearing summary interval...');
      clearInterval(summaryInterval);
      summaryInterval = null;
    }
  };

  // Start a new meeting
  const startMeeting = async () => {
    console.log('Starting new meeting...');
    try {
      setMeetingStatus('starting');
      setIsLoading(true);
      setError(null);
      setTranscript('');

      // Create a new meeting record
      const response = await fetch(`${API_URL}/meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `Meeting ${new Date().toLocaleString()}`,
          startedAt: new Date().toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create meeting');
      }

      const newMeeting = await response.json();
      console.log('Meeting created:', newMeeting);
      setMeeting(newMeeting);

      // Start screen sharing
      console.log('Starting screen share...');
      const stream = await startScreenShare();
      if (!stream) {
        throw new Error('Screen sharing is required to start the meeting');
      }

      // Start audio recording
      console.log('Starting audio recording...');
      mediaRecorder = await startAudioRecording();
      if (!mediaRecorder) {
        throw new Error('Failed to start audio recording');
      }

      setMeetingStatus('in_progress');
      setIsRecording(true);

      // Start sending audio
      startSendingAudio();

      // Start transcription
      if (socket) {
        console.log('Starting transcription...');
        socket.emit('start_transcription', { meetingId: newMeeting._id });

        // Set up summary updates
        console.log('Setting up summary update interval...');
        summaryInterval = setInterval(() => {
          if (socket && newMeeting._id) {
            console.log('Requesting summary update...');
            socket.emit('get_summary_update', { meetingId: newMeeting._id });
          }
        }, 30000);
      }

    } catch (error) {
      console.error('Error starting meeting:', error);
      setError(error.message || 'Failed to start meeting');
      setMeetingStatus('idle');
      stopRecordings();
    } finally {
      setIsLoading(false);
    }
  };

  // End the current meeting
  const endMeeting = async () => {
    console.log('Ending meeting...');
    try {
      setMeetingStatus('ending');
      setIsLoading(true);
      
      // Stop all recordings
      stopRecordings();

      // Notify server
      if (socket && meeting?._id) {
        console.log('Sending end_meeting event...');
        socket.emit('end_meeting', { meetingId: meeting._id });
      }

      // Update local state
      setMeeting(prev => {
        const updated = {
          ...prev,
          endedAt: new Date().toISOString()
        };
        console.log('Meeting marked as ended:', updated);
        return updated;
      });

      setMeetingStatus('completed');
      setIsRecording(false);

    } catch (error) {
      console.error('Error ending meeting:', error);
      setError('Failed to end meeting: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      console.log('Cleaning up...');
      stopRecordings();
      if (socket) {
        console.log('Disconnecting socket...');
        socket.disconnect();
      }
    };
  }, [socket]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Meeting Assistant</h1>
        <div className="app-actions">
          {meetingStatus === 'idle' ? (
            <button
              onClick={startMeeting}
              disabled={isLoading}
              className="btn btn-primary"
            >
              {isLoading ? 'Starting...' : 'Start Meeting'}
            </button>
          ) : (meetingStatus === 'in_progress' || meetingStatus === 'ending') ? (
            <button
              onClick={endMeeting}
              disabled={isLoading}
              className="btn btn-danger"
            >
              {isLoading ? 'Ending...' : 'End Meeting'}
            </button>
          ) : null}
        </div>
      </header>

      <main className="app-content">
        {/* Hidden video element for screen sharing */}
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

        {meeting ? (
          <div className="meeting-container">
            <div className="meeting-header">
              <h2>{meeting.title}</h2>
              <div className="meeting-meta">
                <span>📅 {new Date(meeting.startedAt).toLocaleString()}</span>
                {meeting.endedAt && (
                  <span>⏱️ Ended: {new Date(meeting.endedAt).toLocaleTimeString()}</span>
                )}
                <span className={`status-badge status-${meetingStatus}`}>
                  {meetingStatus.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            <div className="meeting-content">
              <div className="transcript-container">
                <h3>Live Transcript</h3>
                <div className="transcript-content">
                  {transcript || 'Waiting for speech...'}
                </div>
              </div>

              <div className="summary-preview">
                <h3>{meetingStatus === 'completed' ? 'Final Summary' : 'Current Summary'}</h3>
                <div className="summary-content">
                  <p>{meeting.summary || 'Generating summary...'}</p>
                  {meeting.keyPoints?.length > 0 && (
                    <div className="key-points">
                      <h4>Key Points:</h4>
                      <ul>
                        {meeting.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="no-meeting">
            <h2>No active meeting</h2>
            <p>Start a new meeting to begin recording and analysis</p>
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button
              onClick={() => setError(null)}
              className="btn btn-secondary"
            >
              Dismiss
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;