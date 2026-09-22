"""OpenRouter STT service — transcribe audio via OpenRouter API."""
import os
import httpx
import logging
import asyncio
import re

logger = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

# Known hallucination patterns from Whisper on silence/music
# Use word stems — checked against individual words via substring match
HALLUCINATION_PATTERNS = [
    "субтитр", "редактор", "корректор", "синецк", "егоров",
    "сделал", "dimatorzok", "dima", "торзок",
    "продолжение", "следует", "звук", "спасибо", "просмотр",
    "подписывай", "лайк", "коммент",
    "thank you for watching", "please subscribe", "subscribe",
    "амедиа", "amedia", "перевод", "озвучк",
]

# Phrases that indicate hallucination (checked against full text)
HALLUCINATION_PHRASES = [
    "редактор субтитров", "продолжение следует", "спасибо за просмотр",
    "подписывайтесь на канал", "thank you for watching",
    "please subscribe", "субтитры подготовил", "перевод и озвучка",
]


def _is_hallucination(text: str) -> bool:
    """Check if transcribed text looks like a Whisper hallucination."""
    if not text or not text.strip():
        return True
    lower = text.lower().strip()
    # Check phrases first
    for phrase in HALLUCINATION_PHRASES:
        if phrase in lower:
            return True
    # If all words are from hallucination patterns
    words_in_text = [w for w in lower.split() if w]
    if not words_in_text:
        return True
    matches = sum(1 for w in words_in_text if any(pat in w for pat in HALLUCINATION_PATTERNS))
    return matches >= len(words_in_text) * 0.5  # 50%+ words are hallucination patterns


def _filter_words(words: list) -> list:
    """Filter out words with zero-duration or overlapping timestamps."""
    filtered = []
    for w in words:
        start = float(w.get("start", 0))
        end = float(w.get("end", 0))
        word = w.get("word", "").strip()
        if not word:
            continue
        # Skip zero-duration words (likely hallucination artifacts)
        if end <= start and end == start:
            continue
        # Ensure end > start
        if end <= start:
            end = start + 0.1
        filtered.append({"word": word, "start": start, "end": end})
    return filtered


# Model compatibility: whisper-1 is not available on OpenRouter,
# auto-upgrade to whisper-large-v3-turbo
_MODEL_MAP = {
    "openai/whisper-1": "openai/whisper-large-v3-turbo",
    "whisper-1": "openai/whisper-large-v3-turbo",
}

# Default model — whisper-large-v3-turbo (fast, accurate, word-level timestamps)
DEFAULT_MODEL = "openai/whisper-large-v3-turbo"


async def transcribe_via_openrouter(
    audio_path: str,
    model: str = DEFAULT_MODEL,
    language: str = "ru",
    prompt: str = "",
) -> dict:
    """
    Transcribe audio file via OpenRouter STT API using multipart file upload.
    Returns: { words: [{word, start, end}], text, language, duration, model }
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not set")

    # Auto-upgrade deprecated models
    model = _MODEL_MAP.get(model, model)

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
            "temperature": "0.3",
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

    # Parse word-level timestamps
    words = []
    # Try segments first
    for seg in resp_data.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    # Fallback: top-level words
    if not words and "words" in resp_data:
        for w in resp_data["words"]:
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    # Filter hallucinations — check individual words, not nuke everything
    text = resp_data.get("text", "")
    if _is_hallucination(text):
        logger.warning(f"[openrouter-stt] Text looks like hallucination: '{text}' — checking individual words")
        # Only keep words that are NOT hallucination patterns
        clean_words = [w for w in words if not _is_hallucination(w.get("word", ""))]
        if clean_words:
            words = clean_words
            logger.info(f"[openrouter-stt] Kept {len(words)} non-hallucination words")
        else:
            logger.warning(f"[openrouter-stt] ALL {len(words)} words are hallucination — returning empty (segment may be instrumental)")
            words = []

    # Filter zero-duration artifacts
    words = _filter_words(words)

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
    Attempt vocal isolation using ffmpeg filters.
    Uses highpass + lowpass + afftdn to reduce music and isolate vocals.
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