"""
Audio Processing Module for Multi-Modal Meeting Analysis
Handles ASR, speaker diarization, and audio feature extraction
"""
import os
import whisperx
import librosa
import numpy as np
from typing import Dict, List, Tuple, Optional
from dotenv import load_dotenv

load_dotenv()

# WhisperX configuration
DEVICE = "cuda" if os.getenv("USE_GPU", "false").lower() == "true" else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"

def transcribe_with_diarization(audio_path: str, language: str = "en") -> Dict:
    """
    Transcribe audio using WhisperX with speaker diarization.
    
    Args:
        audio_path: Path to audio file
        language: Language code (default: "en")
    
    Returns:
        Dictionary containing transcript segments with speaker labels
    """
    if not os.path.exists(audio_path):
        print(f"⚠️ Audio file not found: {audio_path}")
        return {
            "segments": [],
            "speakers": [],
            "text": ""
        }
    
    try:
        print(f"🎤 Loading audio: {audio_path}")
        audio = whisperx.load_audio(audio_path)
        
        # Load WhisperX model
        print("🤖 Loading WhisperX model...")
        model = whisperx.load_model("large-v2", device=DEVICE, compute_type=COMPUTE_TYPE)
        
        # Transcribe
        print("📝 Transcribing audio...")
        result = model.transcribe(audio, language=language, batch_size=16)
        
        # Align timestamps
        print("⏱️ Aligning timestamps...")
        model_a, metadata = whisperx.load_align_model(language_code=language, device=DEVICE)
        result = whisperx.align(result["segments"], model_a, metadata, audio, device=DEVICE, return_char_alignments=False)
        
        # Speaker diarization (optional, requires HF_TOKEN)
        hf_token = os.getenv("HF_TOKEN")
        if hf_token:
            try:
                print("👥 Performing speaker diarization...")
                diarize_model = whisperx.DiarizationPipeline(use_auth_token=hf_token, device=DEVICE)
                diarize_segments = diarize_model(audio)
                
                # Assign speakers to segments
                result = whisperx.assign_word_speakers(diarize_segments, result)
            except Exception as e:
                print(f"⚠️ Diarization failed (continuing without speaker IDs): {e}")
                # Continue without diarization
        else:
            print("⚠️ HF_TOKEN not set — skipping speaker diarization")
        
        # Extract speaker segments
        speaker_segments = []
        speakers = set()
        
        for segment in result.get("segments", []):
            speaker = segment.get("speaker", "UNKNOWN")
            speakers.add(speaker)
            speaker_segments.append({
                "speaker": speaker,
                "text": segment.get("text", ""),
                "start": segment.get("start", 0.0),
                "end": segment.get("end", 0.0),
                "confidence": segment.get("words", [{}])[0].get("score", 0.0) if segment.get("words") else 0.0
            })
        
        # Generate full transcript
        transcript_text = " ".join([seg["text"] for seg in speaker_segments])
        
        print(f"✅ Transcription complete: {len(speaker_segments)} segments, {len(speakers)} speakers")
        
        return {
            "segments": speaker_segments,
            "speakers": list(speakers),
            "text": transcript_text,
            "language": language
        }
        
    except Exception as e:
        print(f"❌ Error in transcription: {e}")
        return {
            "segments": [],
            "speakers": [],
            "text": ""
        }


def extract_prosody_features(audio_path: str, segments: List[Dict]) -> Dict:
    """
    Extract prosodic features from audio: pitch, tone, speaking rate, energy.
    
    Args:
        audio_path: Path to audio file
        segments: List of transcript segments with timestamps
    
    Returns:
        Dictionary containing prosodic features
    """
    if not os.path.exists(audio_path):
        print(f"⚠️ Audio file not found for prosody analysis: {audio_path}")
        return {
            "pitch": 0.0,
            "tone": 0.0,
            "speakingRate": 0.0,
            "energy": 0.0,
            "pitchVariation": 0.0,
            "energyVariation": 0.0
        }
    
    try:
        print("🎵 Extracting prosodic features...")
        y, sr = librosa.load(audio_path, sr=22050)
        
        # Extract pitch (F0) using pyin
        pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
        pitch_values = []
        for t in range(pitches.shape[1]):
            index = magnitudes[:, t].argmax()
            pitch = pitches[index, t]
            if pitch > 0:
                pitch_values.append(pitch)
        
        avg_pitch = np.mean(pitch_values) if pitch_values else 0.0
        pitch_std = np.std(pitch_values) if pitch_values else 0.0
        
        # Extract energy (RMS)
        rms = librosa.feature.rms(y=y)[0]
        avg_energy = np.mean(rms)
        energy_std = np.std(rms)
        
        # Calculate speaking rate from segments
        total_duration = max([seg.get("end", 0) for seg in segments]) if segments else len(y) / sr
        total_words = sum([len(seg.get("text", "").split()) for seg in segments])
        speaking_rate = total_words / total_duration if total_duration > 0 else 0.0
        
        # Tone estimation (higher pitch variation = more expressive)
        tone_score = min(pitch_std / 50.0, 1.0) if pitch_std > 0 else 0.0
        
        print(f"✅ Prosody features extracted: pitch={avg_pitch:.2f}Hz, rate={speaking_rate:.2f} words/sec")
        
        return {
            "pitch": float(avg_pitch),
            "tone": float(tone_score),
            "speakingRate": float(speaking_rate),
            "energy": float(avg_energy),
            "pitchVariation": float(pitch_std),
            "energyVariation": float(energy_std)
        }
        
    except Exception as e:
        print(f"❌ Error extracting prosody features: {e}")
        return {
            "pitch": 0.0,
            "tone": 0.0,
            "speakingRate": 0.0,
            "energy": 0.0,
            "pitchVariation": 0.0,
            "energyVariation": 0.0
        }


def analyze_sentiment_from_audio(audio_path: str, prosody_features: Dict, transcript: str) -> Dict:
    """
    Analyze sentiment from audio cues (prosody) and text.
    
    Args:
        audio_path: Path to audio file
        prosody_features: Extracted prosodic features
        transcript: Meeting transcript
    
    Returns:
        Dictionary with sentiment analysis results
    """
    try:
        print("😊 Analyzing sentiment from audio cues...")
        
        # Sentiment indicators from prosody
        pitch = prosody_features.get("pitch", 0)
        pitch_var = prosody_features.get("pitchVariation", 0)
        energy = prosody_features.get("energy", 0)
        speaking_rate = prosody_features.get("speakingRate", 0)
        
        # Heuristic-based sentiment scoring
        # High pitch variation + high energy = positive/excited
        # Low pitch variation + low energy = neutral/calm
        # High speaking rate + high energy = urgent/stressed
        
        excitement_score = (pitch_var / 100.0) * (energy / 0.1)
        urgency_score = (speaking_rate / 5.0) * (energy / 0.1)
        
        # Determine sentiment
        if excitement_score > 0.7:
            sentiment = "positive"
            sentiment_score = min(excitement_score, 1.0)
        elif urgency_score > 0.8:
            sentiment = "urgent"
            sentiment_score = min(urgency_score, 1.0)
        elif energy < 0.05:
            sentiment = "neutral"
            sentiment_score = 0.5
        else:
            sentiment = "neutral"
            sentiment_score = 0.6
        
        # Text-based sentiment (simple keyword matching)
        positive_words = ["great", "excellent", "good", "yes", "agree", "thanks", "awesome"]
        negative_words = ["problem", "issue", "concern", "wrong", "no", "disagree", "sorry"]
        
        transcript_lower = transcript.lower()
        positive_count = sum([1 for word in positive_words if word in transcript_lower])
        negative_count = sum([1 for word in negative_words if word in transcript_lower])
        
        # Combine audio and text sentiment
        if positive_count > negative_count:
            sentiment = "positive"
            sentiment_score = min(sentiment_score + 0.2, 1.0)
        elif negative_count > positive_count:
            sentiment = "negative"
            sentiment_score = max(sentiment_score - 0.2, 0.0)
        
        print(f"✅ Sentiment analyzed: {sentiment} (score: {sentiment_score:.2f})")
        
        return {
            "sentiment": sentiment,
            "sentimentScore": float(sentiment_score),
            "excitementScore": float(excitement_score),
            "urgencyScore": float(urgency_score)
        }
        
    except Exception as e:
        print(f"❌ Error in sentiment analysis: {e}")
        return {
            "sentiment": "neutral",
            "sentimentScore": 0.5,
            "excitementScore": 0.0,
            "urgencyScore": 0.0
        }

