"""OpenRouter STT service — transcribe audio via OpenRouter API."""
import os
import httpx
import logging
import asyncio

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"


async def transcribe_via_openrouter(
    audio_path: str,
    model: str = "openai/whisper-1",
    language: str = "ru",
    prompt: str = "",
) -> dict:
    """
    Transcribe audio file via OpenRouter STT API using multipart file upload.
    Returns: { words: [{word, start, end}], text, language, duration, model }
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not set")

    ext = os.path.splitext(audio_path)[1].lower() or ".mp3"
    filename = f"audio{ext}"

    with open(audio_path, "rb") as f:
        files = {
            "file": (filename, f, "audio/mpeg"),
        }
        data = {
            "model": model,
            "language": language,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "word",
        }
        # Whisper-1 supports optional prompt for context
        if prompt:
            data["prompt"] = prompt

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                OPENROUTER_STT_URL,
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                files=files,
                data=data,
            )
            response.raise_for_status()
            resp_data = response.json()

    # Parse word-level timestamps from verbose_json response
    words = []
    for seg in resp_data.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    # Fallback: if no segments with words, try top-level words
    if not words and "words" in resp_data:
        for w in resp_data["words"]:
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    logger.info(f"[openrouter-stt] model={model}, words={len(words)}, duration={resp_data.get('duration', 0):.1f}s, prompt_len={len(prompt)}")

    return {
        "words": words,
        "text": resp_data.get("text", ""),
        "language": resp_data.get("language", language),
        "duration": float(resp_data.get("duration", 0)),
        "model": model,
    }


async def isolate_vocals_ffmpeg(audio_path: str, output_path: str) -> bool:
    """
    Attempt vocal isolation using ffmpeg's center channel extraction filter.
    Returns True if successful, False otherwise.
    Uses afftdn + stereo mixing to isolate center channel (vocals).
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", audio_path,
            "-af", "pan=mono|c0=c0+c1,highpass=f=200,lowpass=f=8000,afftdn=nr=20",
            "-ar", "16000", "-ac", "1", output_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"[vocal-isolation] Success: {output_path}")
            return True
        logger.warning(f"[vocal-isolation] ffmpeg failed: {stderr.decode()[:200]}")
        return False
    except Exception as e:
        logger.warning(f"[vocal-isolation] Error: {e}")
        return False