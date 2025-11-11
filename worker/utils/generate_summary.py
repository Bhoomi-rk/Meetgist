import os
import requests
import json
import base64
from typing import Dict, List, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("❌ GEMINI_API_KEY not found! Please set it in your .env file or environment variables.")

def list_models():
    """
    Fetches the list of available models from the Gemini API.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()

def generate_summary_json(transcript: str) -> dict:
    """
    Generates a summary of the meeting transcript using the Gemini API.
    """
    if not transcript.strip():
        return {"summary": "", "action_items": [], "decisions": [], "important_images": []}

    # Verify available models
    models = list_models()
    print("Available Models:", models)

    # Check if the desired model is available
    model_name = "gemini-1.5-flash"
    available_models = [model["name"] for model in models.get("models", [])]
    if model_name not in available_models:
        raise ValueError(f"❌ Model '{model_name}' not found in available models: {available_models}")

    prompt = f"""
    You are an intelligent meeting summarizer.
    Summarize the following meeting transcript into strictly valid JSON with keys:
    summary (string), action_items (list of objects: text, owner, due), 
    decisions (list of strings), important_images (list of URLs if mentioned).
    Transcript:
    {transcript}
    """

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ]
        }

        headers = {"Content-Type": "application/json"}
        resp = requests.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        # Parse the response
        text_output = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text_output)
        print("🧠 Gemini summary generated.")
        return parsed

    except Exception as e:
        print(f"⚠️ Gemini parsing error: {e}")
        return {
            "summary": "",
            "action_items": [],
            "decisions": [],
            "important_images": [],
        }


def encode_image_to_base64(image_path: str) -> Optional[str]:
    """
    Encode an image file to base64 string for Gemini API.
    
    Args:
        image_path: Path to image file
    
    Returns:
        Base64 encoded string or None if error
    """
    try:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    except Exception as e:
        print(f"⚠️ Error encoding image {image_path}: {e}")
        return None


def generate_multimodal_summary(
    transcript: str,
    audio_features: Dict = None,
    visual_frames: List[Dict] = None,
    speaker_segments: List[Dict] = None,
    sentiment: Dict = None
) -> Dict:
    """
    Generate a multi-modal meeting summary using Gemini Vision API.
    Combines transcript, audio features, and visual frames.
    
    Args:
        transcript: Meeting transcript text
        audio_features: Dictionary with audio prosody features
        visual_frames: List of visual frame metadata
        speaker_segments: List of speaker diarized segments
        sentiment: Sentiment analysis results
    
    Returns:
        Dictionary with multimodal summary and insights
    """
    if not transcript.strip():
        return {
            "summary": "",
            "action_items": [],
            "decisions": [],
            "important_images": [],
            "multimodal_insights": {}
        }
    
    try:
        model_name = "gemini-1.5-flash"
        
        # Build multimodal prompt
        prompt_parts = []
        
        # Text transcript
        transcript_section = f"""
MEETING TRANSCRIPT:
{transcript}
"""
        prompt_parts.append({"text": transcript_section})
        
        # Add audio features context
        if audio_features:
            audio_context = f"""
AUDIO ANALYSIS:
- Speaking Rate: {audio_features.get('speakingRate', 0):.2f} words/second
- Pitch: {audio_features.get('pitch', 0):.2f} Hz
- Tone Variation: {audio_features.get('tone', 0):.2f}
- Energy Level: {audio_features.get('energy', 0):.4f}
"""
            prompt_parts.append({"text": audio_context})
        
        # Add sentiment context
        if sentiment:
            sentiment_context = f"""
SENTIMENT ANALYSIS:
- Overall Sentiment: {sentiment.get('sentiment', 'neutral')}
- Sentiment Score: {sentiment.get('sentimentScore', 0.5):.2f}
- Urgency Level: {sentiment.get('urgencyScore', 0):.2f}
"""
            prompt_parts.append({"text": sentiment_context})
        
        # Add speaker information
        if speaker_segments:
            speakers = set([seg.get('speaker', 'Unknown') for seg in speaker_segments])
            speaker_info = f"""
SPEAKER INFORMATION:
- Total Speakers: {len(speakers)}
- Speakers: {', '.join(speakers)}
"""
            prompt_parts.append({"text": speaker_info})
        
        # Add visual frames with images
        if visual_frames:
            # Select top 5 most relevant frames
            top_frames = sorted(visual_frames, key=lambda x: x.get('relevanceScore', 0), reverse=True)[:5]
            
            visual_context = f"""
VISUAL CONTENT:
- Total Keyframes Extracted: {len(visual_frames)}
- Screenshares Detected: {sum(1 for f in visual_frames if f.get('isScreenshare', False))}
"""
            prompt_parts.append({"text": visual_context})
            
            # Add images to the prompt
            for i, frame in enumerate(top_frames):
                image_url = frame.get('url', '')
                # Extract local path from URL
                image_path = None
                if 'images/' in image_url:
                    # Try different path resolutions
                    possible_paths = [
                        image_url.replace('http://localhost:5000/images/', '../backend/public/images/'),
                        image_url.replace('http://localhost:5000/images/', '../../backend/public/images/'),
                        os.path.join('../backend/public/images/', os.path.basename(image_url)),
                        os.path.join('../../backend/public/images/', os.path.basename(image_url)),
                    ]
                    
                    for path in possible_paths:
                        if os.path.exists(path):
                            image_path = path
                            break
                
                if image_path and os.path.exists(image_path):
                    image_base64 = encode_image_to_base64(image_path)
                    if image_base64:
                        # Get image format
                        img_format = 'jpeg' if (image_path.endswith('.jpg') or image_path.endswith('.jpeg')) else 'png'
                        
                        prompt_parts.append({
                            "inline_data": {
                                "mime_type": f"image/{img_format}",
                                "data": image_base64
                            }
                        })
                        
                        # Add context about the image
                        frame_context = f"""
KEYFRAME {i+1} (Timestamp: {frame.get('timestamp', 0):.2f}s):
- Relevance Score: {frame.get('relevanceScore', 0):.2f}
- Is Screenshare: {frame.get('isScreenshare', False)}
- OCR Text: {frame.get('ocrText', '')[:200]}
- Transcript Context: {frame.get('context', '')[:200]}
"""
                        prompt_parts.append({"text": frame_context})
                else:
                    # If image file not found, just include metadata
                    frame_context = f"""
KEYFRAME {i+1} (Timestamp: {frame.get('timestamp', 0):.2f}s) - Image unavailable:
- Relevance Score: {frame.get('relevanceScore', 0):.2f}
- Is Screenshare: {frame.get('isScreenshare', False)}
- OCR Text: {frame.get('ocrText', '')[:200]}
- Transcript Context: {frame.get('context', '')[:200]}
"""
                    prompt_parts.append({"text": frame_context})
        
        # Main summarization prompt
        summary_prompt = """
You are an intelligent multi-modal meeting summarizer. Analyze the meeting using:
1. Transcript content and speaker information
2. Audio prosody features (speaking rate, pitch, energy)
3. Visual content (screenshares, slides, diagrams)
4. Sentiment and urgency indicators

Generate a comprehensive summary in strictly valid JSON format with the following structure:
{
    "summary": "Detailed meeting summary combining all modalities",
    "action_items": [{"text": "action description", "owner": "speaker name", "due": "deadline if mentioned"}],
    "decisions": ["decision 1", "decision 2"],
    "important_images": ["list of image URLs that are most relevant"],
    "multimodal_insights": {
        "key_visuals": "Description of important visual content discussed",
        "speaker_dynamics": "Analysis of speaker interactions and engagement",
        "emotional_tone": "Overall emotional tone based on audio and text",
        "urgency_indicators": "Key urgency signals from audio and content"
    }
}

Focus on:
- Connecting visual content (slides/diagrams) with discussion points
- Identifying action items with owners from speaker diarization
- Highlighting urgent topics based on audio prosody and sentiment
- Extracting key decisions with supporting visual evidence
"""
        
        prompt_parts.append({"text": summary_prompt})
        
        # Call Gemini API
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        payload = {
            "contents": [
                {
                    "parts": prompt_parts
                }
            ]
        }
        
        headers = {"Content-Type": "application/json"}
        resp = requests.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        
        # Parse the response
        text_output = data["candidates"][0]["content"]["parts"][0]["text"]
        
        # Clean JSON response (remove markdown code blocks if present)
        text_output = text_output.strip()
        if text_output.startswith("```json"):
            text_output = text_output[7:]
        if text_output.startswith("```"):
            text_output = text_output[3:]
        if text_output.endswith("```"):
            text_output = text_output[:-3]
        text_output = text_output.strip()
        
        parsed = json.loads(text_output)
        print("🧠 Multi-modal summary generated with Gemini Vision API.")
        
        return parsed
        
    except json.JSONDecodeError as e:
        print(f"⚠️ JSON parsing error: {e}")
        print(f"Response text: {text_output[:500]}")
        # Fallback to text-only summary
        return generate_summary_json(transcript)
    except Exception as e:
        print(f"⚠️ Multi-modal summary error: {e}")
        import traceback
        traceback.print_exc()
        # Fallback to text-only summary
        return generate_summary_json(transcript)