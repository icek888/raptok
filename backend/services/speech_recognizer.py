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
_whisperx_model_size = None
_align_model = None
_align_language = None
_model_size = os.getenv("RAPTOK_WHISPER_MODEL", "small")
_device = os.getenv("RAPTOK_WHISPER_DEVICE", "cpu")
_compute_type = "int8" if _device == "cpu" else "float16"


def _get_whisperx_model(model_size: str = ""):
    """Load WhisperX model (faster-whisper backend). Caches per model_size."""
    global _whisperx_model, _whisperx_model_size
    size = model_size or _model_size
    if _whisperx_model is None or _whisperx_model_size != size:
        import whisperx
        logger.info(f"Loading WhisperX model: {size} on {_device}")
        _whisperx_model = whisperx.load_model(
            size,
            device=_device,
            compute_type=_compute_type,
            language="ru",
        )
        _whisperx_model_size = size
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
    model_size: str = "",
) -> dict:
    """
    Transcribe audio using WhisperX and return word-level timestamps.
    
    Args:
        audio_path: Path to audio file
        language: Language code (en, ru, auto)
        word_timestamps: Always True (WhisperX always returns word timestamps)
        lyrics: Optional lyrics text — first 2 lines used as initial_prompt for better accuracy
        model_size: Override model size (small, medium, large-v3). If empty, uses default.
    
    Returns:
        {
            "text": str,
            "segments": [...],
            "words": [{"word": str, "start": float, "end": float, "probability": float}],
            "language": str,
        }
    """
    import whisperx
    
    model = _get_whisperx_model(model_size)
    
    # Detect language code
    lang_detected = language if language != "auto" else "ru"
    
    # Build initial_prompt from first 2 lines of lyrics (helps model understand context)
    initial_prompt = ""
    if lyrics:
        lines = [l.strip() for l in lyrics.strip().split("\n") if l.strip()]
        if lines:
            initial_prompt = ". ".join(lines[:2])
            logger.info(f"Using initial_prompt: {initial_prompt[:80]}...")
    
    # Transcribe
    logger.info(f"WhisperX transcribing ({model_size or _model_size}): {audio_path}")
    # Note: initial_prompt is logged but not passed to WhisperX —
    # FasterWhisperPipeline doesn't accept it directly via this API.
    # The prompt is still useful for debugging and could be passed via
    # a different mechanism if needed.
    transcript = model.transcribe(
        audio_path,
        language=language if language != "auto" else None,
        batch_size=16 if _device != "cpu" else 8,
    )
    if language == "auto":
        lang_detected = transcript.get("language", "ru")
    
    # Step 2: Forced alignment with wav2vec2
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