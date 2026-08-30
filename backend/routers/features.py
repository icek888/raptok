"""
Features router — exposes feature flags + enhancement endpoints to frontend.

Endpoints:
- GET  /api/features → list all features + their status (enabled/disabled)
- POST /api/ai-style → unified genre + emotion analysis → recommended template + style
- POST /api/features/auto-cut → smart cut on beats
- POST /api/features/snap-to-beats → snap existing fragments to nearest beats
"""
from fastapi import APIRouter
from pydantic import BaseModel
from services.features import get_flags
from services.ai_style import analyze_style
from services.auto_cut import smart_cut, snap_to_beats
from services.beat_effects import has_beat_effects

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
        "ai_style": {
            "enabled": flags.emotion_style_enabled or flags.genre_template_enabled,
            "emotion_enabled": flags.emotion_style_enabled,
            "genre_enabled": flags.genre_template_enabled,
        },
        "auto_cut": {
            "enabled": flags.auto_cut_enabled,
            "snap_to_beat": flags.auto_cut_snap_to_beat,
            "end_on_beat": flags.auto_cut_end_on_beat,
        },
        "vocal_enhance": {
            "enabled": flags.vocal_enhance_enabled,
            "method": flags.vocal_enhance_method,
        },
    }


# ── AI Style (unified genre + emotion) ──

class AIStyleRequest(BaseModel):
    audio_path: str


@router.post("/api/ai-style")
async def api_ai_style(req: AIStyleRequest):
    """
    Unified AI style analysis — genre + emotion in one response.
    
    Returns:
        genre, genre_confidence, genre_source,
        primary_mood, valence, arousal, moods, emotion_source,
        recommended_template, recommended_style,
        bpm, energy_score
    """
    try:
        return analyze_style(req.audio_path)
    except Exception as e:
        return {
            "error": str(e),
            "genre": "hip-hop", "genre_confidence": 0, "genre_source": "error",
            "primary_mood": "neutral", "valence": 0.5, "arousal": 0.5,
            "moods": [], "emotion_source": "error",
            "recommended_template": None,
            "recommended_style": None,
            "bpm": None, "energy_score": 0.5,
        }


# ── Auto Cut ──

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


# ── Snap to Beats ──

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