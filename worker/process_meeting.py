import sys, os, json
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

# Import helper modules
from utils.extract_images import extract_keyframes
from utils.intelligent_visuals import extract_intelligent_keyframes
from utils.detect_urgency import calculate_urgency
from utils.generate_summary import generate_summary_json, generate_multimodal_summary
from utils.audio_processing import (
    transcribe_with_diarization,
    extract_prosody_features,
    analyze_sentiment_from_audio
)

# Load environment variables
load_dotenv()

# Database setup
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise ValueError("❌ MONGO_URI not found! Please set it in your .env file.")

client = MongoClient(MONGO_URI)
db = client["meetgist"]
meetings = db["meetings"]

if len(sys.argv) < 2:
    print("❌ Usage: python process_meeting.py <meeting_id>")
    sys.exit(1)

mid = sys.argv[1]
meeting = meetings.find_one({"_id": ObjectId(mid)})

if not meeting:
    print("❌ Meeting not found")
    sys.exit(1)

transcript = meeting.get("transcript", "")
audio_path = meeting.get("audioPath")
video_path = meeting.get("videoPath")

print(f"📘 Processing meeting ID: {mid}")
print(f"   Transcript: {'✅' if transcript else '❌'}")
print(f"   Audio: {'✅' if audio_path else '❌'}")
print(f"   Video: {'✅' if video_path else '❌'}")

try:
    # --- Step 1: Audio Processing (ASR + Diarization + Prosody) ---
    speaker_segments = []
    audio_features = None
    sentiment_data = None
    diarization_info = {"speakers": [], "totalSpeakers": 0}
    
    if audio_path and os.path.exists(audio_path):
        print("\n🎤 Step 1: Processing audio with WhisperX...")
        audio_result = transcribe_with_diarization(audio_path)
        speaker_segments = audio_result.get("segments", [])
        diarization_info = {
            "speakers": audio_result.get("speakers", []),
            "totalSpeakers": len(audio_result.get("speakers", []))
        }
        
        # Update transcript if ASR provided better version
        if audio_result.get("text") and len(audio_result.get("text", "")) > len(transcript):
            transcript = audio_result.get("text")
            print("✅ Using ASR transcript (more complete than captions)")
        
        # Extract prosody features
        print("\n🎵 Step 1.1: Extracting prosody features...")
        audio_features = extract_prosody_features(audio_path, speaker_segments)
        
        # Analyze sentiment from audio
        print("\n😊 Step 1.2: Analyzing sentiment from audio cues...")
        sentiment_data = analyze_sentiment_from_audio(audio_path, audio_features, transcript)
    else:
        print("⚠️ No audio file found — using transcript-only processing")
        # Fallback: create basic speaker segments from transcript
        if transcript:
            speaker_segments = [{"speaker": "UNKNOWN", "text": transcript, "start": 0, "end": 0, "confidence": 0.5}]
    
    # --- Step 2: Intelligent Visual Frame Extraction ---
    print("\n🎬 Step 2: Extracting intelligent keyframes...")
    visual_frames = []
    if video_path and os.path.exists(video_path):
        visual_frames = extract_intelligent_keyframes(
            video_path=video_path,
            meeting_id=mid,
            segments=speaker_segments,
            max_frames=20
        )
        print(f"✅ Extracted {len(visual_frames)} intelligent keyframes")
    else:
        # Fallback to basic extraction if no video
        important_images = extract_keyframes(meeting_id=mid, video_path=video_path)
        visual_frames = [{"url": img, "timestamp": 0, "ocrText": "", "relevanceScore": 0.5, 
                         "context": "", "isScreenshare": False} for img in important_images]
        print(f"⚠️ Using basic frame extraction: {len(visual_frames)} frames")
    
    # --- Step 3: Calculate urgency score (enhanced with audio features) ---
    print("\n⚡ Step 3: Calculating urgency score...")
    urgency_score = calculate_urgency(
        transcript, 
        audio_features=audio_features, 
        sentiment=sentiment_data
    )
    print(f"✅ Urgency score calculated: {urgency_score:.2f}")
    
    # --- Step 4: Multi-Modal Summary Generation ---
    print("\n🧠 Step 4: Generating multi-modal summary...")
    if audio_features and visual_frames and len(visual_frames) > 0:
        # Use multimodal fusion
        summary_data = generate_multimodal_summary(
            transcript=transcript,
            audio_features=audio_features,
            visual_frames=visual_frames,
            speaker_segments=speaker_segments,
            sentiment=sentiment_data
        )
        print("✅ Multi-modal summary generated")
    else:
        # Fallback to text-only summary
        summary_data = generate_summary_json(transcript)
        print("✅ Text-only summary generated (fallback)")
    
    # --- Step 5: Prepare update data ---
    update_data = {
        "summary": summary_data.get("summary", ""),
        "actionItems": [
            ai.get("text") if isinstance(ai, dict) else ai
            for ai in summary_data.get("action_items", [])
        ],
        "importantImages": summary_data.get("important_images", [v["url"] for v in visual_frames]),
        "urgencyScore": urgency_score,
        "status": "completed",
    }
    
    # Add multimodal data
    if speaker_segments:
        update_data["speakerSegments"] = speaker_segments
    if audio_features:
        update_data["audioFeatures"] = audio_features
    if sentiment_data:
        update_data["sentiment"] = sentiment_data.get("sentiment", "neutral")
        update_data["sentimentScore"] = sentiment_data.get("sentimentScore", 0.5)
    if visual_frames:
        update_data["visualFrames"] = visual_frames
    if diarization_info:
        update_data["diarization"] = diarization_info
    if summary_data.get("multimodal_insights"):
        update_data["multimodalSummary"] = json.dumps(summary_data.get("multimodal_insights", {}))
    
    # --- Step 6: Save results back to MongoDB ---
    print("\n💾 Step 5: Saving results to database...")
    meetings.update_one(
        {"_id": ObjectId(mid)},
        {"$set": update_data}
    )
    
    print(f"\n✅ Meeting {mid} processed successfully!")
    print(f"   Summary: {len(update_data.get('summary', ''))} chars")
    print(f"   Action Items: {len(update_data.get('actionItems', []))}")
    print(f"   Visual Frames: {len(update_data.get('visualFrames', []))}")
    print(f"   Speakers: {update_data.get('diarization', {}).get('totalSpeakers', 0)}")
    print(f"   Urgency: {urgency_score:.2f}")
    print(f"   Sentiment: {update_data.get('sentiment', 'N/A')}")

except Exception as e:
    print(f"❌ Error processing meeting ID {mid}: {e}")
    import traceback
    traceback.print_exc()
    
    # Update status to error
    meetings.update_one(
        {"_id": ObjectId(mid)},
        {"$set": {"status": "error", "error": str(e)}}
    )
    sys.exit(1)