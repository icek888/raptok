"""
AI Style Analysis — unified genre + emotion detection.

Single entry point: analyze_style(audio_path) → {genre, mood, recommended_template, recommended_style}

Sources (in priority order):
1. HuggingFace dima806/music_genres_classification → genre
2. Music2Emo (AMAAI-Lab) → emotion/mood (valence, arousal, mood tags)
3. audio_analyzer.analyze_track() → heuristic fallback for both

Only ONE librosa.load for heuristic fallback (reuses audio_analyzer result).
HF genre model loads its own audio (sr=16000, 30s sample) — unavoidable.
Music2Emo loads its own audio (torchaudio, sr=24000) — unavoidable.

Caching: results cached per audio_path.
"""
import logging
import os
from typing import Optional

from services.features import get_flags

logger = logging.getLogger(__name__)

# ── Caches ──
_style_cache: dict[str, dict] = {}
_m2e_model = None  # lazy-loaded Music2Emo singleton
_hf_classifier = None  # lazy-loaded HF genre pipeline

# ── Genre → Template mapping ──
GENRE_TEMPLATE_MAP = {
    "hip-hop": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00E6D620",
        "font": "Oswald", "size": 110, "bold": True, "outline_width": 4,
        "description": "Hip-Hop → Neon Pop, bold, aggressive",
    },
    "hiphop": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00E6D620",
        "font": "Oswald", "size": 110, "bold": True, "outline_width": 4,
        "description": "Hip-Hop → Neon Pop, bold, aggressive",
    },
    "rap": {
        "template_id": "big-words",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FFFF00",
        "font": "Oswald", "size": 120, "bold": True, "outline_width": 4,
        "description": "Rap → Big Words, large, punchy",
    },
    "trap": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000E5FF",
        "font": "Oswald", "size": 120, "bold": True, "outline_width": 5,
        "description": "Trap → Neon Pop, maximum impact",
    },
    "pop": {
        "template_id": "cinematic",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0017D7FF",
        "font": "Oswald", "size": 100, "bold": True, "outline_width": 3,
        "description": "Pop → Cinematic, clean, gold",
    },
    "r&b": {
        "template_id": "cinematic",
        "primary_color": "&H00DDDDDD",
        "active_color": "&H00FFD7AA",
        "font": "Arial", "size": 85, "bold": False, "outline_width": 2,
        "description": "R&B → Cinematic, smooth, warm",
    },
    "electronic": {
        "template_id": "big-words",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FF0000",
        "font": "Oswald", "size": 115, "bold": True, "outline_width": 4,
        "description": "Electronic → Big Words, vibrant",
    },
    "rock": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000AAFF",
        "font": "Oswald", "size": 110, "bold": True, "outline_width": 4,
        "description": "Rock → Neon Pop, energetic",
    },
    "lo-fi": {
        "template_id": "cinematic",
        "primary_color": "&H00CCCCCC",
        "active_color": "&H00AAAA88",
        "font": "Arial", "size": 80, "bold": False, "outline_width": 2,
        "description": "Lo-Fi → Cinematic, soft, minimal",
    },
    "drill": {
        "template_id": "neon-pop",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000E5FF",
        "font": "Oswald", "size": 125, "bold": True, "outline_width": 5,
        "description": "Drill → Neon Pop, dark, aggressive",
    },
    "reggae": {
        "template_id": "cinematic",
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000FF55",
        "font": "Oswald", "size": 95, "bold": True, "outline_width": 3,
        "description": "Reggae → Cinematic, warm, relaxed",
    },
}

# ── Mood → Style mapping ──
MOOD_STYLE_MAP = {
    "angry": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0000E5FF",
        "outline_color": "&H00000000", "outline_width": 4,
        "bold": True, "font": "Oswald", "size": 120,
        "position": "center", "margin_v": 40,
        "template_id": "neon-pop",
        "description": "Aggressive → Neon Pop, bold, large",
    },
    "excited": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00FFFF00",
        "outline_color": "&H00000000", "outline_width": 3,
        "bold": True, "font": "Oswald", "size": 110,
        "position": "center", "margin_v": 50,
        "template_id": "big-words",
        "description": "Excited → Big Words, vibrant",
    },
    "happy": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H0017D7FF",
        "outline_color": "&H00000000", "outline_width": 3,
        "bold": True, "font": "Oswald", "size": 100,
        "position": "bottom", "margin_v": 80,
        "template_id": "cinematic",
        "description": "Happy → Cinematic, warm gold",
    },
    "sad": {
        "primary_color": "&H00CCCCCC",
        "active_color": "&H006666AA",
        "outline_color": "&H00000000", "outline_width": 2,
        "bold": False, "font": "Arial", "size": 80,
        "position": "center", "margin_v": 60,
        "template_id": "",
        "description": "Sad → minimal, muted, thin",
    },
    "relaxed": {
        "primary_color": "&H00DDDDDD",
        "active_color": "&H0088AAAA",
        "outline_color": "&H00000000", "outline_width": 2,
        "bold": False, "font": "Arial", "size": 85,
        "position": "bottom", "margin_v": 90,
        "template_id": "cinematic",
        "description": "Chill → Cinematic, soft, understated",
    },
    "neutral": {
        "primary_color": "&H00FFFFFF",
        "active_color": "&H00D7FF",
        "outline_color": "&H00000000", "outline_width": 3,
        "bold": True, "font": "Arial", "size": 90,
        "position": "bottom", "margin_v": 80,
        "template_id": "",
        "description": "Neutral → default style",
    },
}

# Music2Emo mood tags → our style categories
M2E_MOOD_MAP = {
    "angry": "angry", "aggressive": "angry",
    "excited": "excited", "energetic": "excited", "epic": "excited",
    "happy": "happy", "upbeat": "happy", "party": "happy", "fun": "happy",
    "sad": "sad", "melancholic": "sad", "dark": "sad", "serious": "sad",
    "relaxed": "relaxed", "chill": "relaxed", "calm": "relaxed", "soft": "relaxed",
    "love": "relaxed", "romantic": "relaxed",
    "groovy": "excited", "game": "excited",
    "retro": "neutral", "sexy": "relaxed",
}


def _get_m2e_model():
    """Lazy-load Music2Emo model singleton."""
    global _m2e_model
    if _m2e_model is None:
        import sys
        m2e_path = "/usr/local/lib/python3.11/site-packages/music2emo"
        if os.path.isdir(m2e_path):
            if m2e_path not in sys.path:
                sys.path.insert(0, m2e_path)
            os.chdir(m2e_path)
            from music2emo import Music2emo
            _m2e_model = Music2emo()
            logger.info("Music2Emo model loaded")
    return _m2e_model


def _get_hf_classifier():
    """Lazy-load HF genre classifier singleton."""
    global _hf_classifier
    if _hf_classifier is None:
        from transformers import pipeline
        flags = get_flags()
        _hf_classifier = pipeline("audio-classification", model=flags.genre_model)
        logger.info(f"HF genre classifier loaded: {flags.genre_model}")
    return _hf_classifier


def _genre_to_template(genre: str) -> dict:
    """Map genre string to template recommendation."""
    genre = genre.lower().strip()
    if genre in GENRE_TEMPLATE_MAP:
        return GENRE_TEMPLATE_MAP[genre]
    for key, val in GENRE_TEMPLATE_MAP.items():
        if key in genre or genre in key:
            return val
    return GENRE_TEMPLATE_MAP["hip-hop"]


def _mood_to_style(mood: str, valence: float = 0.5, arousal: float = 0.5) -> dict:
    """Map mood + VA values to subtitle style recommendation."""
    mood = mood.lower().strip()
    style = MOOD_STYLE_MAP.get(mood)
    if style:
        return style
    # VA quadrant
    if arousal > 0.6 and valence < 0.4:
        return MOOD_STYLE_MAP["angry"]
    if arousal > 0.6 and valence > 0.6:
        return MOOD_STYLE_MAP["excited"]
    if arousal < 0.4 and valence < 0.4:
        return MOOD_STYLE_MAP["sad"]
    if arousal < 0.4 and valence > 0.6:
        return MOOD_STYLE_MAP["relaxed"]
    return MOOD_STYLE_MAP["neutral"]


def _classify_genre_hf(audio_path: str) -> Optional[dict]:
    """Genre classification via HuggingFace model."""
    try:
        classifier = _get_hf_classifier()
        import librosa
        import numpy as np
        y, sr = librosa.load(audio_path, sr=16000, mono=True)
        mid = len(y) // 2
        sample_len = min(30 * sr, len(y) // 2)
        sample = y[mid - sample_len // 2: mid + sample_len // 2]
        predictions = classifier(np.asarray(sample, dtype=np.float32))
        if not predictions:
            return None
        top = predictions[0]
        genre_label = top["label"].lower().replace(" ", "-")
        return {
            "genre": genre_label,
            "confidence": round(top["score"], 3),
            "all_predictions": [{"label": p["label"], "score": round(p["score"], 3)} for p in predictions[:5]],
            "source": "huggingface",
        }
    except Exception as e:
        logger.warning(f"HF genre failed: {e}")
        return None


def _analyze_emotion_m2e(audio_path: str) -> Optional[dict]:
    """Emotion analysis via Music2Emo model."""
    try:
        model = _get_m2e_model()
        if model is None:
            return None
        output = model.predict(audio_path)
        valence = output.get("valence", 0.5)
        arousal = output.get("arousal", 0.5)
        moods_raw = output.get("predicted_moods", [])
        # Map Music2Emo moods to our categories
        primary_mood = "neutral"
        if moods_raw:
            for m in moods_raw:
                mapped = M2E_MOOD_MAP.get(m.lower().strip())
                if mapped:
                    primary_mood = mapped
                    break
            if primary_mood == "neutral":
                primary_mood = moods_raw[0].lower()
        return {
            "valence": round(valence, 3),
            "arousal": round(arousal, 3),
            "moods": moods_raw,
            "primary_mood": primary_mood,
            "source": "music2emo",
        }
    except Exception as e:
        logger.warning(f"Music2Emo failed: {e}")
        return None


def _heuristic_fallback(audio_path: str) -> dict:
    """Fallback: use audio_analyzer for both genre hint and mood."""
    from services.audio_analyzer import analyze_track
    track_data = analyze_track(audio_path)
    
    # Genre from heuristic
    genre_hint = track_data.get("genre_hint", "Hip-Hop").lower()
    genre_map = {
        "hip-hop/rap": "hip-hop", "trap": "trap", "electronic": "electronic",
        "pop": "pop", "rock": "rock", "r&b": "r&b", "lo-fi": "lo-fi",
        "mixed": "hip-hop",
    }
    genre = genre_map.get(genre_hint, "hip-hop")
    
    # Mood from heuristic
    mood_scores = track_data.get("mood_scores", {})
    mood_label = track_data.get("mood", "Balanced").lower()
    mood_map = {
        "dark hype": "angry", "intense": "excited", "upbeat": "happy",
        "energetic": "excited", "melancholic": "sad", "chill": "relaxed",
        "moody": "sad", "balanced": "neutral",
    }
    primary_mood = mood_map.get(mood_label, "neutral")
    
    return {
        "genre": genre,
        "genre_confidence": 0.6,
        "genre_source": "heuristic",
        "valence": float(mood_scores.get("valence", 0.5)),
        "arousal": float(mood_scores.get("energy", 0.5)),
        "moods": [mood_label],
        "primary_mood": primary_mood,
        "emotion_source": "heuristic",
        "bpm": track_data.get("bpm"),
        "energy_score": float(mood_scores.get("energy", 0.5)),
    }


def analyze_style(audio_path: str) -> dict:
    """
    Unified AI style analysis — genre + emotion in one call.
    
    Returns:
        {
            genre, genre_confidence, genre_source,
            primary_mood, valence, arousal, moods, emotion_source,
            recommended_template, recommended_style,
            bpm, energy_score
        }
    """
    if audio_path in _style_cache:
        return _style_cache[audio_path]
    
    flags = get_flags()
    result = {
        "genre": "hip-hop", "genre_confidence": 0, "genre_source": "none",
        "primary_mood": "neutral", "valence": 0.5, "arousal": 0.5,
        "moods": [], "emotion_source": "none",
        "recommended_template": _genre_to_template("hip-hop"),
        "recommended_style": _mood_to_style("neutral"),
        "bpm": None, "energy_score": 0.5,
    }
    
    # Try HF genre model
    if flags.genre_template_enabled:
        genre_result = _classify_genre_hf(audio_path)
        if genre_result:
            result["genre"] = genre_result["genre"]
            result["genre_confidence"] = genre_result["confidence"]
            result["genre_source"] = genre_result["source"]
            result["genre_all_predictions"] = genre_result.get("all_predictions", [])
    
    # Try Music2Emo
    if flags.emotion_style_enabled:
        emotion_result = _analyze_emotion_m2e(audio_path)
        if emotion_result:
            result["valence"] = emotion_result["valence"]
            result["arousal"] = emotion_result["arousal"]
            result["moods"] = emotion_result["moods"]
            result["primary_mood"] = emotion_result["primary_mood"]
            result["emotion_source"] = emotion_result["source"]
    
    # If either source failed, use heuristic fallback for missing fields
    if result["genre_source"] == "none" or result["emotion_source"] == "none":
        heur = _heuristic_fallback(audio_path)
        if result["genre_source"] == "none":
            result["genre"] = heur["genre"]
            result["genre_confidence"] = heur["genre_confidence"]
            result["genre_source"] = heur["genre_source"]
        if result["emotion_source"] == "none":
            result["valence"] = heur["valence"]
            result["arousal"] = heur["arousal"]
            result["moods"] = heur["moods"]
            result["primary_mood"] = heur["primary_mood"]
            result["emotion_source"] = heur["emotion_source"]
        # Always get BPM + energy from heuristic (cheap, already computed)
        result["bpm"] = heur.get("bpm")
        result["energy_score"] = heur.get("energy_score", 0.5)
    
    # Build recommendations
    result["recommended_template"] = _genre_to_template(result["genre"])
    result["recommended_style"] = _mood_to_style(
        result["primary_mood"], result["valence"], result["arousal"]
    )
    
    logger.info(
        f"AI Style: genre={result['genre']} ({result['genre_source']}, {result['genre_confidence']:.2f}), "
        f"mood={result['primary_mood']} ({result['emotion_source']}), "
        f"V={result['valence']:.2f} A={result['arousal']:.2f}"
    )
    
    _style_cache[audio_path] = result
    return result