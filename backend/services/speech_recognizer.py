"""Speech recognition using faster-whisper for automatic lyric transcription."""
import os
from pathlib import Path
from faster_whisper import WhisperModel


# Cache model instance (loaded on first use)
_model = None
_model_size = os.getenv("RAPTOK_WHISPER_MODEL", "base")


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        # Use CPU by default, GPU if available
        device = os.getenv("RAPTOK_WHISPER_DEVICE", "cpu")
        compute_type = "int8" if device == "cpu" else "float16"
        _model = WhisperModel(_model_size, device=device, compute_type=compute_type)
    return _model


def transcribe_audio(
    audio_path: str,
    language: str = "en",
    word_timestamps: bool = True,
) -> dict:
    """
    Transcribe audio and return word-level timestamps.
    
    Returns:
        {
            "text": str,           # full transcription
            "segments": [...],
            "words": [
                {"word": str, "start": float, "end": float, "probability": float}
            ],
            "language": str,
        }
    """
    model = _get_model()
    
    # Disable VAD filter for music — VAD cuts off singing/rap as "non-speech"
    # This was causing whisper to only recognize first few seconds!
    segments, info = model.transcribe(
        audio_path,
        language=language if language != "auto" else None,
        word_timestamps=word_timestamps,
        vad_filter=False,  # CRITICAL: VAD blocks singing/rapping
        beam_size=5,
        best_of=3,
        condition_on_previous_text=False,  # Don't hallucinate
    )
    
    all_words = []
    all_segments = []
    full_text_parts = []
    
    for seg in segments:
        seg_data = {
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": [],
        }
        
        if seg.words:
            for w in seg.words:
                word_data = {
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(float(w.probability), 3),
                }
                seg_data["words"].append(word_data)
                all_words.append(word_data)
        
        all_segments.append(seg_data)
        full_text_parts.append(seg.text.strip())
    
    return {
        "text": " ".join(full_text_parts),
        "segments": all_segments,
        "words": all_words,
        "language": info.language,
    }


def transcribe_to_lyrics(audio_path: str, language: str = "en") -> dict:
    """
    Transcribe audio and return word-level lyrics with timestamps.
    This is the main entry point for the RapTok workflow.
    """
    result = transcribe_audio(audio_path, language=language, word_timestamps=True)
    
    # Format as lines (group words by natural pauses)
    lines = []
    current_line_words = []
    current_line_start = 0.0
    
    for seg in result["segments"]:
        if not seg["words"]:
            continue
        line_words = []
        for w in seg["words"]:
            line_words.append(w)
        
        if line_words:
            lines.append({
                "text": " ".join(w["word"] for w in line_words),
                "start": line_words[0]["start"],
                "end": line_words[-1]["end"],
                "words": line_words,
            })
    
    return {
        "text": result["text"],
        "lines": lines,
        "words": result["words"],
        "language": result["language"],
    }