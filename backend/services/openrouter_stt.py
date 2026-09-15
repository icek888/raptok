"""OpenRouter STT service — transcribe audio via OpenRouter API."""
import os
import base64
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

# Format mapping: file extension → OpenRouter format string
_FORMAT_MAP = {
    ".wav": "wav", ".mp3": "mp3", ".flac": "flac",
    ".m4a": "m4a", ".ogg": "ogg", ".webm": "webm", ".aac": "aac",
}


def _detect_format(audio_path: str) -> str:
    ext = os.path.splitext(audio_path)[1].lower()
    return _FORMAT_MAP.get(ext, "mp3")


async def transcribe_via_openrouter(
    audio_path: str,
    model: str = "openai/whisper-1",
    language: str = "ru",
) -> dict:
    """
    Transcribe audio file via OpenRouter STT API.
    Returns: { words: [{word, start, end}], text, language, duration, model }
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not set")

    audio_format = _detect_format(audio_path)

    with open(audio_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode()

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            OPENROUTER_STT_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input_audio": {
                    "data": audio_b64,
                    "format": audio_format,
                },
                "language": language,
                "response_format": "verbose_json",
                "timestamp_granularities": ["word"],
            },
        )
        response.raise_for_status()
        data = response.json()

    # Parse word-level timestamps from verbose_json response
    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    # Fallback: if no segments with words, try top-level words
    if not words and "words" in data:
        for w in data["words"]:
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    return {
        "words": words,
        "text": data.get("text", ""),
        "language": data.get("language", language),
        "duration": float(data.get("duration", 0)),
        "model": model,
    }