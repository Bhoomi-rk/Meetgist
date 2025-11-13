require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/meetgist', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('✅ Connected to MongoDB');
});

// Models
const meetingSchema = new mongoose.Schema({
  title: String,
  startedAt: Date,
  endedAt: Date,
  transcript: String,
  summary: String,
  keyPoints: [String],
  actionItems: [{
    text: String,
    assignee: String,
    dueDate: Date
  }],
  sentiment: {
    overall: String,
    score: Number
  },
  diarization: {
    speakers: [{
      id: Number,
      name: String
    }],
    totalSpeakers: Number,
    segments: [{
      speaker: Number,
      text: String,
      startTime: Number,
      endTime: Number
    }]
  },
  audioFeatures: {
    speakingRate: Number,
    pitch: Number,
    volume: Number
  }
}, { timestamps: true });

const Meeting = mongoose.model('Meeting', meetingSchema);

// OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Helper Functions
async function generateSummary(transcript) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that summarizes meeting transcripts. Provide a concise summary of the key points discussed."
        },
        {
          role: "user",
          content: `Please summarize this meeting transcript:\n\n${transcript}`
        }
      ],
      temperature: 0.3,
      max_tokens: 500
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating summary:', error);
    return "Could not generate summary. Please try again later.";
  }
}

async function extractKeyPoints(transcript) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that extracts key points from meeting transcripts. Provide 3-5 bullet points of the most important information."
        },
        {
          role: "user",
          content: `Extract key points from this meeting transcript:\n\n${transcript}`
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    
    // Convert the response into an array of key points
    const content = response.choices[0].message.content;
    return content.split('\n')
      .map(point => point.replace(/^[\d-•*]\s*/, '').trim())
      .filter(point => point.length > 0);
  } catch (error) {
    console.error('Error extracting key points:', error);
    return ["Could not extract key points."];
  }
}

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('start_transcription', async ({ meetingId }) => {
    console.log(`Starting transcription for meeting: ${meetingId}`);
  });

  socket.on('audio_chunk', async ({ meetingId, chunk }) => {
    try {
      // Here you would typically process the audio chunk with a speech-to-text service
      // For this example, we'll simulate transcription
      const mockTranscript = "This is a simulated transcript from the audio chunk.";
      
      // Update the meeting with the new transcript
      const meeting = await Meeting.findById(meetingId);
      if (meeting) {
        meeting.transcript = (meeting.transcript || '') + ' ' + mockTranscript;
        await meeting.save();
        
        // Send the transcript update to the client
        socket.emit('transcript', {
          meetingId,
          text: mockTranscript
        });
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error);
    }
  });

  // Add this new event handler
  socket.on('get_summary_update', async ({ meetingId }) => {
    try {
      const meeting = await Meeting.findById(meetingId);
      if (meeting && meeting.transcript) {
        const summary = await generateSummary(meeting.transcript);
        const keyPoints = await extractKeyPoints(meeting.transcript);
        
        // Update meeting with new summary
        meeting.summary = summary;
        meeting.keyPoints = keyPoints;
        await meeting.save();
        
        // Send update to client
        socket.emit('summary_update', {
          meetingId,
          summary,
          keyPoints
        });
      }
    } catch (error) {
      console.error('Error generating summary update:', error);
    }
  });

  socket.on('end_meeting', async ({ meetingId }) => {
    try {
      const meeting = await Meeting.findById(meetingId);
      if (meeting) {
        // Generate final summary and key points
        const summary = await generateSummary(meeting.transcript);
        const keyPoints = await extractKeyPoints(meeting.transcript);
        
        // Update meeting
        meeting.endedAt = new Date();
        meeting.summary = summary;
        meeting.keyPoints = keyPoints;
        await meeting.save();
        
        // Send final update to client
        socket.emit('meeting_ended', {
          meetingId: meeting._id,
          endedAt: meeting.endedAt,
          summary,
          keyPoints
        });
      }
    } catch (error) {
      console.error('Error ending meeting:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Routes
app.get('/api/meetings', async (req, res) => {
  try {
    const meetings = await Meeting.find().sort({ createdAt: -1 });
    res.json(meetings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

app.post('/api/meetings', async (req, res) => {
  try {
    const meeting = new Meeting({
      title: req.body.title || 'New Meeting',
      startedAt: new Date()
    });
    await meeting.save();
    res.status(201).json(meeting);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create meeting' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});