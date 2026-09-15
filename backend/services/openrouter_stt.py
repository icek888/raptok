"""OpenRouter STT service — transcribe audio via OpenRouter API."""
import os
import httpx
import logging

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"


async def transcribe_via_openrouter(
    audio_path: str,
    model: str = "openai/whisper-1",
    language: str = "ru",
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

    logger.info(f"[openrouter-stt] model={model}, words={len(words)}, duration={resp_data.get('duration', 0):.1f}s")

    return {
        "words": words,
        "text": resp_data.get("text", ""),
        "language": resp_data.get("language", language),
        "duration": float(resp_data.get("duration", 0)),
        "model": model,
    }