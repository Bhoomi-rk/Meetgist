# Multi-Modal Data Fusion Architecture

## Overview

MeetGist implements a comprehensive **multi-modal data fusion** system that goes beyond simple transcript analysis. The system integrates three primary modalities to provide rich, contextual meeting summaries:

1. **Transcript (Text)**: Primary input via ASR and diarization
2. **Visuals (Images/Screenshares)**: Intelligent keyframe extraction with OCR
3. **Voice/Audio Cues**: Prosody analysis for sentiment and urgency detection

## Architecture Components

### 1. Audio Processing Pipeline

**Location**: `worker/utils/audio_processing.py`

#### Features:
- **WhisperX ASR**: Automatic Speech Recognition with speaker diarization
- **Prosody Extraction**: Pitch, tone, speaking rate, and energy analysis using librosa
- **Sentiment Analysis**: Emotion detection from audio cues (prosody + text)

#### Key Functions:
- `transcribe_with_diarization()`: Transcribes audio with speaker identification
- `extract_prosody_features()`: Extracts pitch, energy, speaking rate from audio
- `analyze_sentiment_from_audio()`: Combines prosody and text for sentiment analysis

### 2. Intelligent Visual Frame Selection

**Location**: `worker/utils/intelligent_visuals.py`

#### Features:
- **Screenshare Detection**: Identifies presentation slides vs. video feeds
- **OCR Text Extraction**: Uses EasyOCR to extract text from slides
- **Content-Based Selection**: Extracts frames only when content changes significantly
- **Transcript Matching**: Matches visual frames to relevant transcript segments

#### Key Functions:
- `detect_screenshare()`: Detects if a frame contains a screenshare/presentation
- `extract_text_from_frame()`: OCR text extraction from frames
- `calculate_frame_difference()`: Measures content changes between frames
- `extract_intelligent_keyframes()`: Creates "video skim" with relevant frames only

### 3. Multi-Modal Fusion

**Location**: `worker/utils/generate_summary.py`

#### Features:
- **Gemini Vision API**: Analyzes images with transcript context
- **Cross-Modal Understanding**: Links visual content to discussion points
- **Enhanced Summaries**: Combines text, audio, and visual insights

#### Key Functions:
- `generate_multimodal_summary()`: Fuses all modalities for comprehensive summary
- `encode_image_to_base64()`: Prepares images for Gemini Vision API

### 4. Enhanced Data Model

**Location**: `backend/models/Meeting.js`

#### New Fields:
- `speakerSegments`: Timestamped transcript with speaker IDs
- `audioFeatures`: Prosody features (pitch, tone, speaking rate, energy)
- `visualFrames`: Keyframes with OCR text, relevance scores, and context
- `sentiment`: Overall sentiment and sentiment score
- `diarization`: Speaker identification data
- `multimodalSummary`: Cross-modal insights

## Processing Pipeline

### Step 1: Audio Processing
1. **ASR + Diarization**: Transcribe audio with WhisperX, identify speakers
2. **Prosody Extraction**: Extract pitch, energy, speaking rate from audio signals
3. **Sentiment Analysis**: Analyze emotional tone from prosody + text

### Step 2: Visual Processing
1. **Frame Extraction**: Extract keyframes from video (if available)
2. **Screenshare Detection**: Identify presentation slides
3. **OCR Extraction**: Extract text from slides
4. **Content Matching**: Match frames to transcript timestamps
5. **Relevance Scoring**: Score frames based on content importance

### Step 3: Multi-Modal Fusion
1. **Context Building**: Combine transcript, audio features, visuals, sentiment
2. **Gemini Analysis**: Use Gemini Vision API to analyze images with context
3. **Summary Generation**: Create comprehensive summary with cross-modal insights

### Step 4: Enhanced Urgency Detection
1. **Text-Based**: Semantic variation + speaking rate from transcript
2. **Audio-Based**: Prosody features (pitch, energy, speaking rate)
3. **Sentiment-Based**: Urgency indicators from sentiment analysis
4. **Fusion**: Combined urgency score from all modalities

## Extension Enhancements

### Audio Capture
- **MediaRecorder API**: Captures audio from user's microphone
- **Tab Capture**: Alternative method using Chrome's tabCapture API
- **Real-time Collection**: Collects transcript and audio during meeting

### Data Collection
- **Transcript Buffering**: Collects captions periodically during meeting
- **Audio Recording**: Records audio stream when available
- **Metadata Capture**: Captures meeting title, duration, timestamps

## API Endpoints

### Enhanced Endpoint
```
POST /api/saveMeeting
```
- Accepts: `transcript`, `audio` (file), `video` (file), `title`, `date`
- Returns: Meeting ID and processing status

### Legacy Endpoint (Backward Compatible)
```
POST /api/saveTranscript
```
- Accepts: `transcript`, `source`, `date`
- Returns: Meeting ID

## Configuration

### Environment Variables
- `MONGO_URI`: MongoDB connection string
- `GEMINI_API_KEY`: Google Gemini API key
- `HF_TOKEN`: HuggingFace token for WhisperX diarization (optional)
- `USE_GPU`: Set to "true" to use GPU acceleration (optional)

### Dependencies
- **Python**: WhisperX, librosa, EasyOCR, OpenCV, sentence-transformers
- **Node.js**: Multer (file uploads), Express, Mongoose

## Usage Example

```python
# The processing pipeline automatically:
# 1. Processes audio with ASR + diarization
# 2. Extracts prosody features
# 3. Analyzes sentiment from audio cues
# 4. Extracts intelligent keyframes from video
# 5. Fuses all modalities with Gemini Vision API
# 6. Generates comprehensive summary

# Result includes:
# - Transcript with speaker identification
# - Audio prosody features
# - Visual keyframes with OCR text
# - Sentiment analysis
# - Multi-modal summary with cross-modal insights
```

## Benefits of Multi-Modal Fusion

1. **Better Context Understanding**: Visual content linked to discussion points
2. **Accurate Speaker Identification**: Diarization separates multiple speakers
3. **Emotional Intelligence**: Sentiment and urgency from audio prosody
4. **Visual Relevance**: Only important slides/frames extracted
5. **Comprehensive Summaries**: Cross-modal insights provide richer context

## Future Enhancements

- [ ] Real-time processing during meeting
- [ ] Video transcription with visual context
- [ ] Advanced sentiment analysis with emotion classification
- [ ] Slide change detection for better frame selection
- [ ] Multi-language support for ASR and OCR
- [ ] Integration with calendar for automatic meeting detection

