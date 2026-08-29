"""
Genre classification → auto template selection.

Uses HuggingFace music genre classification model to detect genre,
then maps genre to the best RapTok template + color palette.

Falls back to heuristic (from audio_analyzer.guess_genre) if model not installed.
"""
import logging
from typing import Optional
from services.features import get_flags

logger = logging.getLogger(__name__)

# Cache for genre results
_genre_cache: dict[str, dict] = {}


# ── Genre → Template mapping ──
GENRE_TEMPLATE_MAP = {
    "hip-hop": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00E6D620",   # neon yellow-green
        "font": "Oswald",
        "size": 110,
        "bold": True,
        "outline_width": 4,
        "description": "Hip-Hop → Neon Pop, bold, aggressive",
    },
    "rap": {
        "template_id": "big-words",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FFFF00",   # cyan
        "font": "Oswald",
        "size": 120,
        "bold": True,
        "outline_width": 4,
        "description": "Rap → Big Words, large, punchy",
    },
    "trap": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000E5FF",   # orange-red
        "font": "Oswald",
        "size": 120,
        "bold": True,
        "outline_width": 5,
        "description": "Trap → Neon Pop, maximum impact",
    },
    "pop": {
        "template_id": "cinematic",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0017D7FF",   # gold
        "font": "Oswald",
        "size": 100,
        "bold": True,
        "outline_width": 3,
        "description": "Pop → Cinematic, clean, gold",
    },
    "r&b": {
        "template_id": "cinematic",
        "primary_color": "&H00DDDDDD",
        "active_color": "&H00FFD7AA",   # soft warm
        "font": "Arial",
        "size": 85,
        "bold": False,
        "outline_width": 2,
        "description": "R&B → Cinematic, smooth, warm",
    },
    "electronic": {
        "template_id": "big-words",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FF0000",   # blue
        "font": "Oswald",
        "size": 115,
        "bold": True,
        "outline_width": 4,
        "description": "Electronic → Big Words, vibrant",
    },
    "rock": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000AAFF",   # orange
        "font": "Oswald",
        "size": 110,
        "bold": True,
        "outline_width": 4,
        "description": "Rock → Neon Pop, energetic",
    },
    "lo-fi": {
        "template_id": "cinematic",
        "primary_color": "&H00CCCCCC",
        "active_color": "&H00AAAA88",   # muted
        "font": "Arial",
        "size": 80,
        "bold": False,
        "outline_width": 2,
        "description": "Lo-Fi → Cinematic, soft, minimal",
    },
    "drill": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000E5FF",
        "font": "Oswald",
        "size": 125,
        "bold": True,
        "outline_width": 5,
        "description": "Drill → Neon Pop, dark, aggressive",
    },
}


def is_available() -> bool:
    """Check if genre template is enabled."""
    return get_flags().genre_template_enabled


def classify_genre(audio_path: str) -> Optional[dict]:
    """
    Classify genre from audio file.
    Returns {genre, confidence, recommended_template} or None if unavailable.

    Tries HuggingFace model first, falls back to heuristic.
    """
    flags = get_flags()
    if not flags.genre_template_enabled:
        return None

    if audio_path in _genre_cache:
        return _genre_cache[audio_path]

    result = None

    # Try HuggingFace model
    try:
        from transformers import pipeline
        import librosa
        import numpy as np

        classifier = pipeline("audio-classification", model=flags.genre_model)
        y, sr = librosa.load(audio_path, sr=16000, mono=True)
        # Use 30s sample from middle
        mid = len(y) // 2
        sample_len = min(30 * sr, len(y) // 2)
        sample = y[mid - sample_len // 2: mid + sample_len // 2]
        predictions = classifier(np.asarray(sample, dtype=np.float32))

        top = predictions[0] if predictions else None
        if top:
            genre_label = top["label"].lower().replace(" ", "-")
            confidence = top["score"]

            result = {
                "genre": genre_label,
                "confidence": round(confidence, 3),
                "all_predictions": [{"label": p["label"], "score": round(p["score"], 3)} for p in predictions[:5]],
                "source": "huggingface",
                "recommended_template": _genre_to_template(genre_label),
            }
            logger.info(f"Genre (HF): {genre_label} ({confidence:.2f})")

    except ImportError:
        logger.info("Transformers/genre model not installed, using fallback")
        result = _fallback_genre(audio_path)

    except Exception as e:
        logger.warning(f"Genre model failed: {e}, using fallback")
        result = _fallback_genre(audio_path)

    if result:
        _genre_cache[audio_path] = result

    return result


def _fallback_genre(audio_path: str) -> Optional[dict]:
    """Use heuristic genre detection from audio_analyzer."""
    try:
        from services.audio_analyzer import analyze_track
        track_data = analyze_track(audio_path)
        genre_hint = track_data.get("genre_hint", "Mixed").lower()

        # Normalize our heuristic labels
        genre_map = {
            "hip-hop/rap": "hip-hop",
            "trap": "trap",
            "electronic": "electronic",
            "pop": "pop",
            "rock": "rock",
            "r&b": "r&b",
            "lo-fi": "lo-fi",
            "mixed": "hip-hop",  # default for rap tool
        }
        genre = genre_map.get(genre_hint, "hip-hop")

        result = {
            "genre": genre,
            "confidence": 0.6,
            "source": "heuristic",
            "recommended_template": _genre_to_template(genre),
        }
        logger.info(f"Genre (fallback): {genre} (from hint: {genre_hint})")
        return result

    except Exception as e:
        logger.warning(f"Fallback genre failed: {e}")
        return None


def _genre_to_template(genre: str) -> dict:
    """Map genre string to template recommendation."""
    # Direct match
    if genre in GENRE_TEMPLATE_MAP:
        return GENRE_TEMPLATE_MAP[genre]

    # Partial match
    for key, val in GENRE_TEMPLATE_MAP.items():
        if key in genre or genre in key:
            return val

    # Default
    return GENRE_TEMPLATE_MAP["hip-hop"]


def get_recommended_template(audio_path: str) -> Optional[dict]:
    """Convenience: get only the recommended template dict."""
    result = classify_genre(audio_path)
    if result:
        return result.get("recommended_template")
    return None