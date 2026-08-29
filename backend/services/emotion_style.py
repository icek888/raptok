"""
Emotion-based auto-style — uses Music2Emo to detect track emotion
and recommends subtitle style (colors, font, position) based on mood.

Falls back gracefully if model not installed (returns None).
"""
import logging
from typing import Optional
from services.features import get_flags

logger = logging.getLogger(__name__)

# Cache for emotion results (avoid re-analyzing same file)
_emotion_cache: dict[str, dict] = {}


# ── Mood → Style mapping ──
# Each mood maps to subtitle style recommendations
MOOD_STYLE_MAP = {
    # High energy, aggressive
    "angry": {
        "primary_color": "&H00FFFFFF",  # white
        "active_color": "&H0000E5FF",   # orange-red
        "outline_color": "&H00000000",
        "outline_width": 4,
        "bold": True,
        "font": "Oswald",
        "size": 120,
        "position": "center",
        "margin_v": 40,
        "template_id": "neon-pop",
        "description": "Aggressive → Neon Pop, bold, large",
    },
    "excited": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FFFF00",   # cyan
        "outline_color": "&H00000000",
        "outline_width": 3,
        "bold": True,
        "font": "Oswald",
        "size": 110,
        "position": "center",
        "margin_v": 50,
        "template_id": "big-words",
        "description": "Excited → Big Words, vibrant",
    },
    # Happy, positive
    "happy": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0017D7FF",   # gold
        "outline_color": "&H00000000",
        "outline_width": 3,
        "bold": True,
        "font": "Oswald",
        "size": 100,
        "position": "bottom",
        "margin_v": 80,
        "template_id": "cinematic",
        "description": "Happy → Cinematic, warm gold",
    },
    # Sad, melancholic
    "sad": {
        "primary_color": "&H00CCCCCC",
        "active_color": "&H006666AA",   # muted blue
        "outline_color": "&H00000000",
        "outline_width": 2,
        "bold": False,
        "font": "Arial",
        "size": 80,
        "position": "center",
        "margin_v": 60,
        "template_id": "",
        "description": "Sad → minimal, muted, thin",
    },
    # Calm, relaxed
    "relaxed": {
        "primary_color": "&H00DDDDDD",
        "active_color": "&H0088AAAA",   # soft teal
        "outline_color": "&H00000000",
        "outline_width": 2,
        "bold": False,
        "font": "Arial",
        "size": 85,
        "position": "bottom",
        "margin_v": 90,
        "template_id": "cinematic",
        "description": "Chill → Cinematic, soft, understated",
    },
    # Default
    "neutral": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00D7FF",      # default active
        "outline_color": "&H00000000",
        "outline_width": 3,
        "bold": True,
        "font": "Arial",
        "size": 90,
        "position": "bottom",
        "margin_v": 80,
        "template_id": "",
        "description": "Neutral → default style",
    },
}


def is_available() -> bool:
    """Check if emotion analysis is enabled and model is available."""
    return get_flags().emotion_style_enabled


def analyze_emotion(audio_path: str) -> Optional[dict]:
    """
    Analyze emotion from audio file using Music2Emo.
    Returns {valence, arousal, moods, recommended_style} or None if unavailable.

    Falls back to librosa-based heuristic if model not installed.
    """
    flags = get_flags()
    if not flags.emotion_style_enabled:
        return None

    # Check cache
    if audio_path in _emotion_cache:
        return _emotion_cache[audio_path]

    result = None

    # Try Music2Emo model
    try:
        from music2emo import Music2emo
        model = Music2emo()
        output = model.predict(audio_path)

        valence = output.get("valence", 0.5)
        arousal = output.get("arousal", 0.5)
        moods = output.get("predicted_moods", ["neutral"])
        primary_mood = moods[0].lower() if moods else "neutral"

        result = {
            "valence": round(valence, 3),
            "arousal": round(arousal, 3),
            "moods": moods,
            "primary_mood": primary_mood,
            "source": "music2emo",
            "recommended_style": _mood_to_style(primary_mood, valence, arousal),
        }
        logger.info(f"Emotion analysis (Music2Emo): mood={primary_mood}, valence={valence:.2f}, arousal={arousal:.2f}")

    except ImportError:
        logger.info("Music2Emo not installed, using fallback heuristic")
        result = _fallback_emotion(audio_path)

    except Exception as e:
        logger.warning(f"Music2Emo failed: {e}, using fallback")
        result = _fallback_emotion(audio_path)

    # Cache result
    if result:
        _emotion_cache[audio_path] = result

    return result


def _fallback_emotion(audio_path: str) -> Optional[dict]:
    """Fallback: use existing audio_analyzer for emotion detection."""
    try:
        from services.audio_analyzer import analyze_track
        track_data = analyze_track(audio_path)
        mood_scores = track_data.get("mood_scores", {})
        mood_label = track_data.get("mood", "Balanced").lower()

        # Map our existing mood labels to style
        mood_map = {
            "dark hype": "angry",
            "intense": "excited",
            "upbeat": "happy",
            "energetic": "excited",
            "melancholic": "sad",
            "chill": "relaxed",
            "moody": "sad",
            "balanced": "neutral",
        }
        primary_mood = mood_map.get(mood_label, "neutral")

        result = {
            "valence": mood_scores.get("valence", 0.5),
            "arousal": mood_scores.get("energy", 0.5),
            "moods": [mood_label],
            "primary_mood": primary_mood,
            "source": "heuristic",
            "recommended_style": _mood_to_style(primary_mood, mood_scores.get("valence", 0.5), mood_scores.get("energy", 0.5)),
        }
        logger.info(f"Emotion analysis (fallback): mood={primary_mood}, label={mood_label}")
        return result

    except Exception as e:
        logger.warning(f"Fallback emotion failed: {e}")
        return None


def _mood_to_style(mood: str, valence: float, arousal: float) -> dict:
    """Map mood + VA values to subtitle style recommendation."""
    # Direct mapping
    style = MOOD_STYLE_MAP.get(mood)
    if style:
        return style

    # VA quadrant mapping
    if arousal > 0.6 and valence < 0.4:
        return MOOD_STYLE_MAP["angry"]
    if arousal > 0.6 and valence > 0.6:
        return MOOD_STYLE_MAP["excited"]
    if arousal < 0.4 and valence < 0.4:
        return MOOD_STYLE_MAP["sad"]
    if arousal < 0.4 and valence > 0.6:
        return MOOD_STYLE_MAP["relaxed"]

    return MOOD_STYLE_MAP["neutral"]


def get_recommended_style(audio_path: str) -> Optional[dict]:
    """Convenience: get only the recommended style dict."""
    result = analyze_emotion(audio_path)
    if result:
        return result.get("recommended_style")
    return None