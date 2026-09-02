"""Transcription router: transcribe, transcribe-full, SSE stream, stem separation."""
import json
import time
import asyncio
import logging
import os
import subprocess
from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import StreamingResponse
from models.schemas import TranscribeRequest, TranscribeResult
from services.speech_recognizer import transcribe_to_lyrics, transcribe_audio
from services.forced_alignment import align_lyrics_to_timings
from services.bpm_detector import detect_bpm
from services.stem_separator import separate_vocals, separate_vocals_with_stems

logger = logging.getLogger(__name__)
router = APIRouter()

TEMP_DIR = os.environ.get("TEMP_DIR", "/tmp/raptok")


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
    clip_start: float = Form(0.0),
    clip_length: float = Form(0.0),
):
    """Transcribe with SSE progress updates.
    
    v3: If clip_start + clip_length provided, only transcribes that segment
    (e.g. 37s instead of full 5-min track → 10x faster on CPU).
    """
    async def generate():
        try:
            t0 = time.time()
            def elapsed():
                return round(time.time() - t0, 1)

            # ── v3: Cut segment if clip_range provided ──
            whisper_input = audio_path
            segment_offset = 0.0  # time offset for word timestamps
            if clip_length > 0 and clip_start >= 0:
                yield f"data: {json.dumps({'step': 'cut', 'label': f'Cutting segment ({clip_length:.0f}s)...', 'progress': 3, 'elapsed': elapsed()})}\n\n"
                seg_path = os.path.join(TEMP_DIR, f"seg_{hash(audio_path)}_{clip_start}_{clip_length}.wav")
                if not os.path.exists(seg_path):
                    proc = await asyncio.create_subprocess_exec(
                        "ffmpeg", "-y", "-ss", str(clip_start), "-t", str(clip_length),
                        "-i", audio_path, "-ar", "16000", "-ac", "1", seg_path,
                        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.wait()
                whisper_input = seg_path
                segment_offset = clip_start
                yield f"data: {json.dumps({'step': 'cut', 'label': f'Segment ready ({clip_length:.0f}s) ✓', 'progress': 8, 'elapsed': elapsed()})}\n\n"

            # Step 1: Stem separation (on segment if cut, or full track)
            yield f"data: {json.dumps({'step': 'separation', 'label': 'Separating vocals from music...', 'progress': 10, 'elapsed': elapsed()})}\n\n"
            try:
                vocal_path = await separate_vocals(whisper_input, method="auto")
                whisper_input = vocal_path
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Vocals isolated ✓', 'progress': 30, 'elapsed': elapsed()})}\n\n"
            except Exception as e:
                logger.warning(f"Stem separation failed ({e})")
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Using original audio (separation skipped)', 'progress': 30, 'elapsed': elapsed()})}\n\n"

            # Step 2: WhisperX transcription (on segment)
            model_label = model_size or "small"
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'WhisperX transcribing ({model_label})...', 'progress': 35, 'elapsed': elapsed()})}\n\n"
            loop = asyncio.get_event_loop()
            whisper_result = await loop.run_in_executor(
                None,
                lambda: transcribe_audio(whisper_input, language=language, word_timestamps=True, lyrics=lyrics, model_size=model_size),
            )
            whisper_words = whisper_result.get("words", [])
            
            # ── Shift word timestamps back to absolute (clip_start offset) ──
            if segment_offset > 0:
                for w in whisper_words:
                    if isinstance(w, dict):
                        w["start"] = round(w.get("start", 0) + segment_offset, 3)
                        w["end"] = round(w.get("end", 0) + segment_offset, 3)
            
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'Transcribed {len(whisper_words)} words ✓', 'progress': 75, 'elapsed': elapsed()})}\n\n"

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
