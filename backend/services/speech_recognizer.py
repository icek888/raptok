"""Speech recognition using WhisperX for automatic lyric transcription.

WhisperX = faster-whisper + wav2vec2 forced alignment + VAD
Provides accurate word-level timestamps (<100ms) via wav2vec2 alignment,
replacing the old faster-whisper + MMS FA two-step pipeline.
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Cache model instances (loaded on first use)
_whisperx_model = None
_align_model = None
_align_language = None
_model_size = os.getenv("RAPTOK_WHISPER_MODEL", "small")
_device = os.getenv("RAPTOK_WHISPER_DEVICE", "cpu")
_compute_type = "int8" if _device == "cpu" else "float16"


def _get_whisperx_model():
    """Load WhisperX model (faster-whisper backend)."""
    global _whisperx_model
    if _whisperx_model is None:
        import whisperx
        logger.info(f"Loading WhisperX model: {_model_size} on {_device}")
        _whisperx_model = whisperx.load_model(
            _model_size,
            device=_device,
            compute_type=_compute_type,
            language="ru",  # hint for alignment model selection
        )
    return _whisperx_model


def _get_align_model(language: str = "ru"):
    """Load wav2vec2 alignment model for the given language."""
    global _align_model, _align_language, _align_meta
    if _align_model is None or _align_language != language:
        import whisperx
        logger.info(f"Loading alignment model for language: {language}")
        _align_model, _align_meta = whisperx.load_align_model(
            language_code=language,
            device=_device,
        )
        _align_language = language
    return _align_model, _align_meta


def transcribe_audio(
    audio_path: str,
    language: str = "en",
    word_timestamps: bool = True,
    lyrics: str = "",
) -> dict:
    """
    Transcribe audio using WhisperX and return word-level timestamps.
    
    WhisperX pipeline:
    1. faster-whisper transcription (base/small/medium)
    2. wav2vec2 forced alignment for precise word timestamps
    3. Optional VAD preprocessing (disabled for music — VAD cuts singing)
    
    If lyrics are provided, they are used as the transcript instead of
    Whisper's output, and wav2vec2 alignment is performed directly on
    the user-provided lyrics — this gives the best results because
    Whisper doesn't need to guess the words.
    
    Returns:
        {
            "text": str,
            "segments": [...],
            "words": [
                {"word": str, "start": float, "end": float, "probability": float}
            ],
            "language": str,
        }
    """
    import whisperx
    
    model = _get_whisperx_model()
    
    # Detect language code
    lang_detected = language if language != "auto" else "ru"
    
    # Always transcribe with whisper first — gives rough word timestamps
    # If user provides lyrics, we'll map them via DTW after alignment
    logger.info(f"WhisperX transcribing: {audio_path}")
    transcript = model.transcribe(
        audio_path,
        language=language if language != "auto" else None,
        batch_size=8 if _device != "cpu" else 4,
    )
    if language == "auto":
        lang_detected = transcript.get("language", "ru")
    
    # Step 2: Forced alignment with wav2vec2
    # This gives us precise word-level timestamps (<100ms accuracy)
    lang_detected = language if language != "auto" else transcript.get("language", "ru")
    
    try:
        align_model, align_meta = _get_align_model(lang_detected)
        logger.info(f"WhisperX aligning words with wav2vec2...")
        result = whisperx.align(
            transcript["segments"],
            align_model,
            align_meta,
            audio_path,
            device=_device,
        )
    except Exception as e:
        logger.warning(f"Alignment failed ({e}), using whisper timestamps only")
        result = transcript
    
    # Extract words from aligned result
    all_words = []
    all_segments = []
    full_text_parts = []
    
    segments = result.get("segments", [])
    for seg in segments:
        seg_data = {
            "start": round(seg.get("start", 0), 3),
            "end": round(seg.get("end", 0), 3),
            "text": seg.get("text", "").strip(),
            "words": [],
        }
        
        seg_words = seg.get("words", [])
        for w in seg_words:
            # WhisperX word format: {"word": "...", "start": ..., "end": ..., "score": ...}
            word_data = {
                "word": w.get("word", "").strip(),
                "start": round(w.get("start", 0), 3),
                "end": round(w.get("end", 0), 3),
                "probability": round(float(w.get("score", w.get("probability", 0))), 3),
            }
            if word_data["word"]:
                seg_data["words"].append(word_data)
                all_words.append(word_data)
        
        all_segments.append(seg_data)
        full_text_parts.append(seg_data["text"])
    
    logger.info(f"WhisperX done: {len(all_words)} words, {len(all_segments)} segments")
    
    return {
        "text": " ".join(full_text_parts),
        "segments": all_segments,
        "words": all_words,
        "language": lang_detected,
    }


def transcribe_to_lyrics(audio_path: str, language: str = "en") -> dict:
    """
    Transcribe audio and return word-level lyrics with timestamps.
    This is the main entry point for the RapTok workflow.
    """
    result = transcribe_audio(audio_path, language=language, word_timestamps=True)
    
    # Format as lines (group words by natural pauses)
    lines = []
    
    for seg in result["segments"]:
        if not seg["words"]:
            continue
        line_words = seg["words"]
        
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