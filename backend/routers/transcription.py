"""Transcription router: transcribe, transcribe-full, SSE stream, stem separation."""
import json
import time
import asyncio
import logging
from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import TranscribeRequest, TranscribeResult
from services.speech_recognizer import transcribe_to_lyrics, transcribe_audio
from services.forced_alignment import align_lyrics_to_timings
from services.bpm_detector import detect_bpm
from services.stem_separator import separate_vocals, separate_vocals_with_stems

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/transcribe", response_model=TranscribeResult)
async def api_transcribe(req: TranscribeRequest):
    """Transcribe audio and get word-level lyrics with timestamps."""
    try:
        return transcribe_to_lyrics(req.audio_path, language=req.language)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _run_transcription_pipeline(audio_path: str, language: str, lyrics: str, model_size: str):
    """Shared pipeline: stem separation → WhisperX → alignment.
    Returns dict with result fields.
    """
    # Step 1: Stem separation
    try:
        vocal_path = await separate_vocals(audio_path, method="auto")
        whisper_input = vocal_path
        logger.info(f"Using isolated vocals: {vocal_path}")
    except Exception as e:
        logger.warning(f"Stem separation failed ({e}), using original audio")
        whisper_input = audio_path

    # Step 1b: Vocal enhancement (optional, modular)
    try:
        from services.vocal_enhance import enhance_if_enabled
        whisper_input = enhance_if_enabled(whisper_input)
    except Exception as e:
        logger.warning(f"Vocal enhancement skipped: {e}")

    # Step 2: WhisperX transcribe + align
    whisper_result = transcribe_audio(
        whisper_input, language=language, word_timestamps=True,
        lyrics=lyrics, model_size=model_size,
    )
    whisper_words = whisper_result.get("words", [])
    user_lyrics = lyrics.strip() if lyrics else ""

    # Step 3: Alignment if user provided lyrics
    if user_lyrics:
        try:
            bpm_result = detect_bpm(audio_path)
            full_bpm = bpm_result.get("bpm", 0.0)
        except Exception:
            full_bpm = 0.0

        import librosa
        full_duration = librosa.get_duration(path=audio_path)
        word_timings = align_lyrics_to_timings(user_lyrics, whisper_words)

        return {
            "text": user_lyrics,
            "words": [w.model_dump() if hasattr(w, 'model_dump') else w for w in word_timings],
            "language": whisper_result.get("language", "unknown"),
            "method": "whisperx_alignment",
            "whisper_words": len(whisper_words),
            "aligned_words": len(word_timings),
            "bpm": full_bpm,
            "total_duration": round(full_duration, 2),
        }

    return {
        "text": whisper_result.get("text", ""),
        "words": whisper_words,
        "language": whisper_result.get("language", "unknown"),
        "method": "whisperx_only",
    }


@router.post("/api/transcribe-full")
async def api_transcribe_full(
    audio_path: str = Form(...),
    language: str = Form("en"),
    lyrics: str = Form(""),
    model_size: str = Form(""),
):
    """Transcribe ENTIRE audio track. Returns absolute word timestamps."""
    try:
        return await _run_transcription_pipeline(audio_path, language, lyrics, model_size)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/transcribe-full-stream")
async def api_transcribe_full_stream(
    audio_path: str = Form(...),
    language: str = Form("en"),
    lyrics: str = Form(""),
    model_size: str = Form(""),
):
    """Transcribe with SSE progress updates."""
    async def generate():
        try:
            t0 = time.time()
            def elapsed():
                return round(time.time() - t0, 1)

            # Step 1: Stem separation
            yield f"data: {json.dumps({'step': 'separation', 'label': 'Separating vocals from music...', 'progress': 5, 'elapsed': elapsed()})}\n\n"
            try:
                vocal_path = await separate_vocals(audio_path, method="auto")
                whisper_input = vocal_path
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Vocals isolated ✓', 'progress': 25, 'elapsed': elapsed()})}\n\n"
            except Exception as e:
                logger.warning(f"Stem separation failed ({e})")
                whisper_input = audio_path
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Using original audio (separation skipped)', 'progress': 25, 'elapsed': elapsed()})}\n\n"

            # Step 2: WhisperX transcription
            model_label = model_size or "small"
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'WhisperX transcribing ({model_label})...', 'progress': 30, 'elapsed': elapsed()})}\n\n"
            loop = asyncio.get_event_loop()
            whisper_result = await loop.run_in_executor(
                None,
                lambda: transcribe_audio(whisper_input, language=language, word_timestamps=True, lyrics=lyrics, model_size=model_size),
            )
            whisper_words = whisper_result.get("words", [])
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'Transcribed {len(whisper_words)} words ✓', 'progress': 70, 'elapsed': elapsed()})}\n\n"

            user_lyrics = lyrics.strip() if lyrics else ""

            # Step 3: Alignment
            if user_lyrics:
                yield f"data: {json.dumps({'step': 'alignment', 'label': 'Aligning lyrics to audio...', 'progress': 75, 'elapsed': elapsed()})}\n\n"
                try:
                    bpm_result = detect_bpm(audio_path)
                    full_bpm = bpm_result.get("bpm", 0.0)
                except Exception:
                    full_bpm = 0.0
                import librosa
                full_duration = librosa.get_duration(path=audio_path)
                word_timings = align_lyrics_to_timings(user_lyrics, whisper_words)
                yield f"data: {json.dumps({'step': 'alignment', 'label': f'Aligned {len(word_timings)} words ✓', 'progress': 95, 'elapsed': elapsed()})}\n\n"
                result = {
                    "text": user_lyrics,
                    "words": [w.model_dump() if hasattr(w, 'model_dump') else w for w in word_timings],
                    "language": whisper_result.get("language", "unknown"),
                    "method": "whisperx_alignment",
                    "whisper_words": len(whisper_words),
                    "aligned_words": len(word_timings),
                    "bpm": full_bpm,
                    "total_duration": round(full_duration, 2),
                }
            else:
                yield f"data: {json.dumps({'step': 'alignment', 'label': 'Finalizing timestamps...', 'progress': 95, 'elapsed': elapsed()})}\n\n"
                result = {
                    "text": whisper_result.get("text", ""),
                    "words": whisper_words,
                    "language": whisper_result.get("language", "unknown"),
                    "method": "whisperx_only",
                }

            yield f"data: {json.dumps({'step': 'done', 'label': 'Complete ✓', 'progress': 100, 'elapsed': elapsed(), 'result': result})}\n\n"
        except Exception as e:
            logger.error(f"Transcribe stream error: {e}")
            yield f"data: {json.dumps({'step': 'error', 'label': str(e), 'progress': 0})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/api/stem-separate")
async def api_stem_separate(
    audio_path: str = Form(...),
    method: str = Form("auto"),
):
    """Separate vocals from instrumental. Returns paths to stems."""
    try:
        stems = await separate_vocals_with_stems(audio_path, method=method)
        return {
            "stems": stems,
            "method": "ml" if "drums" in stems else "ffmpeg",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── Background pre-transcription cache ──
# In-memory store: audio_path → {status, result, error, started_at}
_pretranscribe_cache: dict[str, dict] = {}
_pretranscribe_lock = asyncio.Lock()


@router.post("/api/pretranscribe")
async def api_pretranscribe(
    audio_path: str = Form(...),
    language: str = Form("ru"),
    model_size: str = Form("large-v3"),
):
    """Start stem separation + WhisperX in the background.
    
    Returns immediately with status='started'. Frontend polls /api/pretranscribe/status.
    Result is cached in memory — when user reaches Lyrics step, it's already done.
    """
    async with _pretranscribe_lock:
        existing = _pretranscribe_cache.get(audio_path)
        if existing and existing.get("status") in ("running", "done"):
            return {"status": existing["status"], "message": "Already running or done"}

        _pretranscribe_cache[audio_path] = {
            "status": "running",
            "result": None,
            "error": None,
            "started_at": time.time(),
        }

    # Fire and forget — runs in background
    asyncio.create_task(_run_pretranscribe(audio_path, language, model_size))
    return {"status": "started", "message": "Background transcription started"}


@router.get("/api/pretranscribe/status")
async def api_pretranscribe_status(audio_path: str):
    """Check status of background pre-transcription."""
    entry = _pretranscribe_cache.get(audio_path)
    if not entry:
        return {"status": "not_started"}
    return {
        "status": entry["status"],
        "result": entry["result"],
        "error": entry["error"],
        "elapsed": round(time.time() - entry["started_at"], 1) if entry.get("started_at") else 0,
    }


async def _run_pretranscribe(audio_path: str, language: str, model_size: str):
    """Background task: separate vocals → transcribe → cache result."""
    try:
        t0 = time.time()
        logger.info(f"[pretranscribe] Starting for {audio_path} (model={model_size})")

        # Step 1: Stem separation (cached by stem_separator itself)
        vocal_path = await separate_vocals(audio_path, method="auto")
        logger.info(f"[pretranscribe] Vocals separated in {time.time()-t0:.1f}s")

        # Step 2: WhisperX transcription
        loop = asyncio.get_event_loop()
        whisper_result = await loop.run_in_executor(
            None,
            lambda: transcribe_audio(vocal_path, language=language, word_timestamps=True, model_size=model_size),
        )
        whisper_words = whisper_result.get("words", [])
        logger.info(f"[pretranscribe] WhisperX done in {time.time()-t0:.1f}s, {len(whisper_words)} words")

        result = {
            "text": whisper_result.get("text", ""),
            "words": whisper_words,
            "language": whisper_result.get("language", "unknown"),
            "method": "whisperx_only",
        }

        _pretranscribe_cache[audio_path] = {
            "status": "done",
            "result": result,
            "error": None,
            "started_at": t0,
        }
        logger.info(f"[pretranscribe] Complete in {time.time()-t0:.1f}s")

    except Exception as e:
        logger.error(f"[pretranscribe] Failed: {e}")
        _pretranscribe_cache[audio_path] = {
            "status": "error",
            "result": None,
            "error": str(e),
            "started_at": time.time(),
        }
