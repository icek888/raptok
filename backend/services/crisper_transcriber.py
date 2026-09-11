"""
CrisperWhisper transcriber — alternative to WhisperX for word-level timestamps.
~30ms boundary error (2x more accurate than WhisperX's ~65ms).

Uses transformers backend (pure torch) to avoid ctranslate2 conflict with WhisperX.
Model: nyralabs/CrisperWhisper2.0_small (int8 not available on transformers backend,
but small model runs ~120s for 25s audio on CPU — acceptable for short segments).
"""

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

_crisper_model = None
_crisper_model_size = None


def _get_crisper_model(model_size: str = "small"):
    """Load CrisperWhisper model (cached globally)."""
    global _crisper_model, _crisper_model_size
    
    size_map = {
        "small": "nyralabs/CrisperWhisper2.0_small",
        "medium": "nyralabs/CrisperWhisper2.0_medium",
        "large": "nyralabs/CrisperWhisper2.0_large",
        "turbo": "nyralabs/CrisperWhisper2.0_turbo",
    }
    
    hf_id = size_map.get(model_size, size_map["small"])
    
    if _crisper_model is None or _crisper_model_size != model_size:
        from crisperwhisper import CrisperWhisperModel
        logger.info(f"Loading CrisperWhisper ({model_size}) with transformers backend...")
        t0 = time.time()
        _crisper_model = CrisperWhisperModel(
            hf_id,
            backend="transformers",
            device="cpu",
        )
        _crisper_model_size = model_size
        logger.info(f"CrisperWhisper loaded in {time.time() - t0:.1f}s")
    
    return _crisper_model


def transcribe_audio_crisper(
    audio_path: str,
    language: str = "ru",
    lyrics: str = "",
    model_size: str = "small",
) -> dict:
    """
    Transcribe audio using CrisperWhisper.
    
    If lyrics provided, uses forced_align (text from user, timestamps from audio).
    Otherwise, transcribes normally with word_timestamps=True.
    
    Returns same format as speech_recognizer.transcribe_audio:
    {
        "text": str,
        "segments": [{"start", "end", "text", "words": [...]}],
        "words": [{"word", "start", "end", "probability"}],
        "language": str,
    }
    """
    model = _get_crisper_model(model_size)
    
    if lyrics and lyrics.strip():
        # Use forced_align — user text + audio timestamps
        logger.info(f"CrisperWhisper forced_align with user lyrics ({len(lyrics)} chars)")
        result = model.forced_align(audio_path, lyrics, language=language)
    else:
        # Normal transcription
        logger.info(f"CrisperWhisper transcribing: {audio_path}")
        result = model.transcribe(
            audio_path,
            language=language,
            word_timestamps=True,
        )
    
    # Convert to our standard format
    all_words = []
    for w in result.words:
        word_data = {
            "word": w.word.strip(),
            "start": round(w.start, 3),
            "end": round(w.end, 3),
            "probability": round(float(getattr(w, "probability", getattr(w, "score", 0.9))), 3),
        }
        if word_data["word"]:
            all_words.append(word_data)
    
    # Group words into segments (by gaps > 0.5s)
    segments = []
    current_seg_words = []
    for i, w in enumerate(all_words):
        if current_seg_words and i > 0:
            gap = w["start"] - all_words[i - 1]["end"]
            if gap > 0.5:
                segments.append({
                    "start": current_seg_words[0]["start"],
                    "end": current_seg_words[-1]["end"],
                    "text": " ".join(w["word"] for w in current_seg_words),
                    "words": current_seg_words,
                })
                current_seg_words = []
        current_seg_words.append(w)
    
    if current_seg_words:
        segments.append({
            "start": current_seg_words[0]["start"],
            "end": current_seg_words[-1]["end"],
            "text": " ".join(w["word"] for w in current_seg_words),
            "words": current_seg_words,
        })
    
    full_text = " ".join(w["word"] for w in all_words)
    
    logger.info(f"CrisperWhisper done: {len(all_words)} words, {len(segments)} segments")
    
    return {
        "text": full_text,
        "segments": segments,
        "words": all_words,
        "language": language,
    }


def is_crisper_available() -> bool:
    """Check if CrisperWhisper is installed and available."""
    try:
        import crisperwhisper
        return True
    except ImportError:
        return False