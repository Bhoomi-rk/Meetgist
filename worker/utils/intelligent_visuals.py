"""
Intelligent Visual Frame Selection Module
Detects screenshares, extracts keyframes based on content changes and transcript context,
and uses OCR to extract slide content.
"""
import os
import cv2
import numpy as np
import easyocr
from typing import List, Dict, Tuple, Optional
from datetime import datetime
import json

# Initialize EasyOCR reader (English)
try:
    reader = easyocr.Reader(['en'], gpu=os.getenv("USE_GPU", "false").lower() == "true")
    OCR_AVAILABLE = True
except Exception as e:
    print(f"⚠️ EasyOCR initialization failed: {e}")
    OCR_AVAILABLE = False
    reader = None


def detect_screenshare(frame: np.ndarray) -> bool:
    """
    Detect if a frame contains a screenshare/presentation.
    Heuristic: screenshares typically have less color variation and more text.
    
    Args:
        frame: Image frame as numpy array
    
    Returns:
        True if frame appears to be a screenshare
    """
    try:
        # Convert to grayscale
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Calculate color variance (screenshares have lower variance)
        color_variance = np.var(frame)
        
        # Detect edges (screenshares have more structured edges)
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / (frame.shape[0] * frame.shape[1])
        
        # Detect text regions (screenshares have more text)
        # Simple heuristic: look for high contrast rectangular regions
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        text_like_regions = sum([1 for c in contours if cv2.contourArea(c) > 100])
        
        # Heuristic: screenshare if low color variance, high edge density, or many text-like regions
        is_screenshare = (
            color_variance < 2000 or
            edge_density > 0.1 or
            text_like_regions > 20
        )
        
        return is_screenshare
        
    except Exception as e:
        print(f"⚠️ Error detecting screenshare: {e}")
        return False


def extract_text_from_frame(frame: np.ndarray) -> str:
    """
    Extract text from a frame using OCR.
    
    Args:
        frame: Image frame as numpy array
    
    Returns:
        Extracted text string
    """
    if not OCR_AVAILABLE or reader is None:
        return ""
    
    try:
        results = reader.readtext(frame)
        text = " ".join([result[1] for result in results if result[2] > 0.5])  # confidence > 0.5
        return text
    except Exception as e:
        print(f"⚠️ OCR error: {e}")
        return ""


def calculate_frame_difference(frame1: np.ndarray, frame2: np.ndarray) -> float:
    """
    Calculate the difference between two frames.
    Returns a score indicating how different the frames are.
    
    Args:
        frame1: First frame
        frame2: Second frame
    
    Returns:
        Difference score (0-1, higher = more different)
    """
    try:
        # Convert to grayscale
        gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
        
        # Calculate structural similarity
        # Higher difference = more change
        diff = cv2.absdiff(gray1, gray2)
        diff_score = np.mean(diff) / 255.0
        
        # Also check histogram difference
        hist1 = cv2.calcHist([gray1], [0], None, [256], [0, 256])
        hist2 = cv2.calcHist([gray2], [0], None, [256], [0, 256])
        hist_diff = cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL)
        hist_score = 1.0 - hist_diff
        
        # Combined score
        combined_score = (diff_score + hist_score) / 2.0
        
        return float(combined_score)
        
    except Exception as e:
        print(f"⚠️ Error calculating frame difference: {e}")
        return 0.0


def match_frame_to_transcript(frame_timestamp: float, segments: List[Dict], window: float = 5.0) -> Optional[Dict]:
    """
    Match a frame to the corresponding transcript segment based on timestamp.
    
    Args:
        frame_timestamp: Timestamp of the frame in seconds
        segments: List of transcript segments with start/end times
        window: Time window in seconds to search for matching segment
    
    Returns:
        Matching segment or None
    """
    for segment in segments:
        start = segment.get("start", 0)
        end = segment.get("end", 0)
        
        # Check if frame timestamp is within segment time window
        if start - window <= frame_timestamp <= end + window:
            return segment
    
    return None


def extract_intelligent_keyframes(
    video_path: str,
    meeting_id: str,
    segments: List[Dict] = None,
    output_dir: str = "../backend/public/images",
    min_change_threshold: float = 0.15,
    max_frames: int = 20
) -> List[Dict]:
    """
    Extract intelligent keyframes from video based on content changes and transcript context.
    Creates a "video skim" by selecting only important frames.
    
    Args:
        video_path: Path to video file
        meeting_id: Meeting ID for naming
        segments: List of transcript segments for context matching
        output_dir: Directory to save extracted frames
        min_change_threshold: Minimum frame difference to consider a new keyframe
        max_frames: Maximum number of frames to extract
    
    Returns:
        List of frame metadata dictionaries
    """
    if not video_path or not os.path.exists(video_path):
        print("🎞️ No video file found — skipping intelligent frame extraction.")
        return []
    
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        print(f"🎬 Starting intelligent frame extraction from: {video_path}")
        cap = cv2.VideoCapture(video_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        print(f"📊 Video info: {total_frames} frames, {fps} fps, {duration:.2f}s duration")
        
        keyframes = []
        prev_frame = None
        frame_no = 0
        last_keyframe_time = -10.0  # Minimum time between keyframes (seconds)
        min_frame_interval = fps * 3  # Minimum 3 seconds between keyframes
        
        while cap.isOpened() and len(keyframes) < max_frames:
            ret, frame = cap.read()
            if not ret:
                break
            
            current_time = frame_no / fps if fps > 0 else 0
            
            # Skip if too soon after last keyframe
            if current_time - last_keyframe_time < 3.0:
                frame_no += 1
                continue
            
            # Calculate frame difference
            if prev_frame is not None:
                diff_score = calculate_frame_difference(prev_frame, frame)
            else:
                diff_score = 1.0  # First frame is always important
            
            # Detect if this is a screenshare
            is_screenshare = detect_screenshare(frame)
            
            # Extract text from frame
            ocr_text = extract_text_from_frame(frame) if is_screenshare else ""
            
            # Match to transcript segment
            context = None
            relevance_score = 0.5  # Default relevance
            if segments:
                matched_segment = match_frame_to_transcript(current_time, segments)
                if matched_segment:
                    context = matched_segment.get("text", "")
                    relevance_score = 0.8  # Higher relevance if matched to transcript
            
            # Decide if this is a keyframe
            is_keyframe = False
            
            # Always include first frame
            if prev_frame is None:
                is_keyframe = True
            # Include if significant change detected
            elif diff_score > min_change_threshold:
                is_keyframe = True
            # Include if screenshare with text
            elif is_screenshare and len(ocr_text) > 20:
                is_keyframe = True
            # Include if matched to important transcript segment
            elif context and len(context) > 50:
                is_keyframe = True
            
            if is_keyframe:
                # Save frame
                img_name = f"{meeting_id}_frame_{frame_no}_{int(current_time)}.jpg"
                img_path = os.path.join(output_dir, img_name)
                cv2.imwrite(img_path, frame)
                
                # Calculate relevance score
                if is_screenshare:
                    relevance_score += 0.2
                if len(ocr_text) > 50:
                    relevance_score += 0.1
                relevance_score = min(relevance_score, 1.0)
                
                frame_url = f"http://localhost:5000/images/{img_name}"
                
                keyframes.append({
                    "url": frame_url,
                    "timestamp": current_time,
                    "ocrText": ocr_text,
                    "relevanceScore": relevance_score,
                    "context": context or "",
                    "isScreenshare": is_screenshare,
                    "frameNumber": frame_no
                })
                
                last_keyframe_time = current_time
                print(f"✅ Keyframe {len(keyframes)}: t={current_time:.2f}s, screenshare={is_screenshare}, relevance={relevance_score:.2f}")
            
            prev_frame = frame.copy()
            frame_no += 1
            
            # Skip frames for efficiency (check every 0.5 seconds)
            skip_frames = max(1, fps // 2)
            for _ in range(skip_frames - 1):
                cap.read()
                frame_no += 1
        
        cap.release()
        
        # Sort by relevance score and timestamp
        keyframes.sort(key=lambda x: (x["relevanceScore"], x["timestamp"]), reverse=True)
        
        # Limit to top N frames
        keyframes = keyframes[:max_frames]
        
        print(f"🖼️ Extracted {len(keyframes)} intelligent keyframes")
        return keyframes
        
    except Exception as e:
        print(f"❌ Error extracting keyframes: {e}")
        import traceback
        traceback.print_exc()
        return []


def analyze_visual_content_with_gemini(frame_path: str, transcript_context: str = "") -> Dict:
    """
    Analyze visual content of a frame using Gemini Vision API.
    (To be integrated with generate_summary.py)
    
    Args:
        frame_path: Path to image file
        transcript_context: Relevant transcript context for the frame
    
    Returns:
        Analysis results dictionary
    """
    # This will be integrated with Gemini Vision API in the fusion module
    # Placeholder for now
    return {
        "description": "",
        "relevance": 0.0,
        "topics": []
    }

