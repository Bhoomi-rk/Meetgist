import numpy as np
from sentence_transformers import SentenceTransformer
from typing import Dict, Optional

def calculate_urgency(transcript: str, audio_features: Optional[Dict] = None, sentiment: Optional[Dict] = None) -> float:
    """
    Compute urgency score based on semantic variation, speaking rate, and audio cues.
    Enhanced with multi-modal analysis when audio features are available.
    
    Args:
        transcript: Meeting transcript text
        audio_features: Optional dictionary with audio prosody features
        sentiment: Optional dictionary with sentiment analysis results
    
    Returns:
        Float urgency score (0-10 range)
    """
    words = transcript.split()
    word_count = len(words)
    duration = max(1.0, word_count / 2.5)  # ~2.5 words/sec
    speaking_rate = word_count / duration

    # Compute semantic variation
    sbert = SentenceTransformer("all-MiniLM-L6-v2")
    chunks = [transcript[i:i + 800] for i in range(0, len(transcript), 800)]
    if chunks:
        embs = sbert.encode(chunks)
        semantic_var = float(np.std(embs))
    else:
        semantic_var = 0.0

    # Base urgency from text
    text_urgency = semantic_var + (speaking_rate / 10.0)
    
    # Enhance with audio features if available
    if audio_features:
        # High speaking rate = more urgent
        audio_speaking_rate = audio_features.get("speakingRate", 0)
        rate_factor = min(audio_speaking_rate / 5.0, 2.0)  # Normalize to 0-2
        
        # High energy = more urgent
        energy = audio_features.get("energy", 0)
        energy_factor = min(energy / 0.1, 2.0)  # Normalize to 0-2
        
        # High pitch variation = more expressive/urgent
        pitch_var = audio_features.get("pitchVariation", 0)
        pitch_factor = min(pitch_var / 50.0, 1.0)  # Normalize to 0-1
        
        audio_urgency = (rate_factor + energy_factor + pitch_factor) / 3.0
        text_urgency = (text_urgency + audio_urgency * 2.0) / 2.0
    
    # Enhance with sentiment if available
    if sentiment:
        urgency_score = sentiment.get("urgencyScore", 0)
        if urgency_score > 0:
            # Combine text and sentiment urgency
            text_urgency = (text_urgency + urgency_score * 2.0) / 2.0
    
    # Normalize to 0-10 range
    urgency = min(max(0.0, text_urgency * 2.0), 10.0)
    urgency = round(urgency, 2)

    print(f"⚡ Urgency Score: {urgency:.2f} (text: {semantic_var:.2f}, audio: {'yes' if audio_features else 'no'})")
    return urgency
