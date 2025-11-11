require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { spawn } = require('child_process');
const Meeting = require('./models/Meeting');
const app = express();

// Create directories for uploads
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const imagesDir = path.join(__dirname, 'public', 'images');
[uploadsDir, imagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg',
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio and video files are allowed.'));
    }
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/uploads', express.static(uploadsDir));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// API Routes with Error Handling

// Enhanced endpoint for multi-modal meeting data
app.post('/api/saveMeeting', upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'video', maxCount: 1 }
]), async (req, res) => {
  try {
    const { transcript, source, date, title } = req.body;
    const audioFile = req.files?.audio?.[0];
    const videoFile = req.files?.video?.[0];
    
    // Prepare meeting data
    const meetingData = {
      transcript: transcript || '',
      source: source || 'google-meet',
      date: date || new Date().toISOString(),
      title: title || 'Meeting',
      status: 'processing'
    };
    
    // Add file paths if uploaded
    if (audioFile) {
      meetingData.audioPath = audioFile.path;
    }
    if (videoFile) {
      meetingData.videoPath = videoFile.path;
    }
    
    const m = new Meeting(meetingData);
    await m.save();

    // Start processing in background
    const py = spawn('python3', [
      path.join(__dirname, '../worker/process_meeting.py'),
      m._id.toString()
    ], {
      cwd: path.join(__dirname, '../worker')
    });

    py.stdout.on('data', (d) => console.log('py:', d.toString()));
    py.stderr.on('data', (d) => console.error('py-err:', d.toString()));
    
    py.on('error', (err) => {
      console.error('❌ Failed to start Python process:', err);
    });

    res.json({ ok: true, id: m._id, message: 'Meeting saved and processing started' });
  } catch (error) {
    console.error('❌ Error saving meeting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint for transcript-only (backward compatibility)
app.post('/api/saveTranscript', async (req, res) => {
  try {
    const { transcript, source, date } = req.body;
    const m = new Meeting({ transcript, source, date, status: 'processing' });
    await m.save();

    const py = spawn('python3', [
      path.join(__dirname, '../worker/process_meeting.py'),
      m._id.toString()
    ], {
      cwd: path.join(__dirname, '../worker')
    });

    py.stdout.on('data', (d) => console.log('py:', d.toString()));
    py.stderr.on('data', (d) => console.error('py-err:', d.toString()));

    res.json({ ok: true, id: m._id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

 app.get('/api/lastSummary', async (req,res)=>{
 const last = await Meeting.findOne().sort({createdAt:-1});
 res.json(last||{});
 });


 app.get('/api/allMeetings', async (req,res)=>{
 const all = await Meeting.find().sort({createdAt:-1});
 res.json(all);
 });

 app.get('/api/meeting/:id', async (req,res)=>{ const m = await
 Meeting.findById(req.params.id); res.json(m||{}); });

 app.post('/api/updateLast', async (req,res)=>{
 const last = await Meeting.findOne().sort({createdAt:-1});
 if (!last) return res.json({error:'no meeting'});
 const { title, date } = req.body;
 last.title = title || last.title;
 last.date = date || last.date;
 await last.save();
 res.json({ok:true});
 });

 app.delete('/api/meeting/:id', async (req,res)=>{ await
 Meeting.deleteOne({_id:req.params.id}); res.json({ok:true}); });

 app.listen(5000, ()=> console.log('Server running on http://localhost:5000'));