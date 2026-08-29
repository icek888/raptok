"""
Features router — exposes feature flags + enhancement endpoints to frontend.

Frontend can:
- GET /api/features → list all features + their status (enabled/disabled)
- POST /api/features/emotion → analyze emotion → get recommended style
- POST /api/features/genre → classify genre → get recommended template
- POST /api/features/auto-cut → smart cut on beats
"""
from fastapi import APIRouter
from pydantic import BaseModel
from services.features import get_flags
from services.emotion_style import analyze_emotion, is_available as emotion_available
from services.genre_template import classify_genre, is_available as genre_available
from services.auto_cut import smart_cut, snap_to_beats, is_available as autocut_available
from services.beat_effects import has_beat_effects
from services.vocal_enhance import is_available as vocal_available

router = APIRouter()


@router.get("/api/features")
async def get_features():
    """List all features and their enabled/disabled status."""
    flags = get_flags()
    return {
        "beat_effects": {
            "enabled": flags.beat_effects_enabled,
            "zoom_intensity": flags.beat_zoom_intensity,
            "flash_intensity": flags.beat_flash_intensity,
            "shake_intensity": flags.beat_shake_intensity,
        },
        "emotion_style": {
            "enabled": flags.emotion_style_enabled,
            "available": emotion_available(),
        },
        "auto_cut": {
            "enabled": flags.auto_cut_enabled,
            "snap_to_beat": flags.auto_cut_snap_to_beat,
            "end_on_beat": flags.auto_cut_end_on_beat,
        },
        "genre_template": {
            "enabled": flags.genre_template_enabled,
            "available": genre_available(),
        },
        "vocal_enhance": {
            "enabled": flags.vocal_enhance_enabled,
            "method": flags.vocal_enhance_method,
        },
    }


class EmotionRequest(BaseModel):
    audio_path: str


@router.post("/api/features/emotion")
async def api_analyze_emotion(req: EmotionRequest):
    """Analyze emotion from audio → recommended subtitle style."""
    result = analyze_emotion(req.audio_path)
    if result:
        return result
    return {"error": "Emotion analysis not available", "recommended_style": None}


class GenreRequest(BaseModel):
    audio_path: str


@router.post("/api/features/genre")
async def api_classify_genre(req: GenreRequest):
    """Classify genre from audio → recommended template."""
    result = classify_genre(req.audio_path)
    if result:
        return result
    return {"error": "Genre classification not available", "recommended_template": None}


class AutoCutRequest(BaseModel):
    duration: float
    beats: list[float]
    energy_curve: list[float] | None = None
    energy_times: list[float] | None = None
    count: int = 7
    min_frag: float = 3.0
    max_frag: float = 6.0


@router.post("/api/features/auto-cut")
async def api_auto_cut(req: AutoCutRequest):
    """Smart cut: select fragments at energy peaks, snapped to beats."""
    fragments = smart_cut(
        duration=req.duration,
        beats=req.beats,
        energy_curve=req.energy_curve,
        energy_times=req.energy_times,
        count=req.count,
        min_frag=req.min_frag,
        max_frag=req.max_frag,
    )
    return {
        "fragments": fragments,
        "count": len(fragments),
        "beat_synced": True,
    }


class SnapRequest(BaseModel):
    fragments: list[dict]
    beats: list[float]
    snap_start: bool = True
    snap_end: bool = True


@router.post("/api/features/snap-to-beats")
async def api_snap_to_beats(req: SnapRequest):
    """Snap existing fragment boundaries to nearest beats."""
    from models.schemas import Fragment
    frags = [Fragment(**f) for f in req.fragments]
    result = snap_to_beats(frags, req.beats, req.snap_start, req.snap_end)
    return {"fragments": result}