"""
RapTok Feature Flags — modular on/off switches for all enhancement modules.

Each feature can be toggled via environment variable or config.
Disabled features are silently skipped — no crash, no import error.
"""
import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class FeatureFlags:
    """All feature toggles. Change via env vars or directly."""

    # 1. Beat-synced transitions (zoom pulse, flash, shake)
    beat_effects_enabled: bool = True
    beat_zoom_intensity: float = 0.08      # 0-0.2, how much zoom on beat
    beat_flash_intensity: float = 0.3      # 0-1, white flash opacity on beat
    beat_shake_intensity: float = 0.0     # 0-1, camera shake on heavy beats (off by default)
    beat_flash_on_drop: bool = True       # flash only on energy drops/peaks

    # 2. Emotion-based auto-style (Music2Emo)
    emotion_style_enabled: bool = True
    emotion_model: str = "amaai-lab/music2emo"  # HuggingFace model

    # 3. Auto-cut on beats (improved fragment selection)
    auto_cut_enabled: bool = True
    auto_cut_snap_to_beat: bool = True    # snap fragment start to nearest beat
    auto_cut_end_on_beat: bool = True      # snap fragment end to nearest beat

    # 4. Genre classification → auto template
    genre_template_enabled: bool = True
    genre_model: str = "dima806/music_genres_classification"

    # 5. Vocal enhancement (before transcription)
    vocal_enhance_enabled: bool = False    # off by default (heavy on CPU)
    vocal_enhance_method: str = "resemble"  # "resemble" or "clearervoice"

    @classmethod
    def from_env(cls) -> "FeatureFlags":
        """Load flags from environment variables."""
        def env_bool(key: str, default: bool) -> bool:
            val = os.getenv(key, "").lower()
            if val in ("1", "true", "yes", "on"):
                return True
            if val in ("0", "false", "no", "off"):
                return False
            return default

        def env_float(key: str, default: float) -> float:
            try:
                return float(os.getenv(key, default))
            except (ValueError, TypeError):
                return default

        return cls(
            beat_effects_enabled=env_bool("RAPTOK_BEAT_EFFECTS", True),
            beat_zoom_intensity=env_float("RAPTOK_BEAT_ZOOM", 0.08),
            beat_flash_intensity=env_float("RAPTOK_BEAT_FLASH", 0.3),
            beat_shake_intensity=env_float("RAPTOK_BEAT_SHAKE", 0.0),
            beat_flash_on_drop=env_bool("RAPTOK_BEAT_FLASH_DROP", True),
            emotion_style_enabled=env_bool("RAPTOK_EMOTION_STYLE", True),
            auto_cut_enabled=env_bool("RAPTOK_AUTO_CUT", True),
            auto_cut_snap_to_beat=env_bool("RAPTOK_AUTOCUT_SNAP", True),
            auto_cut_end_on_beat=env_bool("RAPTOK_AUTOCUT_END_BEAT", True),
            genre_template_enabled=env_bool("RAPTOK_GENRE_TEMPLATE", True),
            vocal_enhance_enabled=env_bool("RAPTOK_VOCAL_ENHANCE", False),
        )


# Singleton — loaded once
_flags: Optional[FeatureFlags] = None


def get_flags() -> FeatureFlags:
    """Get the global feature flags instance."""
    global _flags
    if _flags is None:
        _flags = FeatureFlags.from_env()
    return _flags


def reload_flags():
    """Reload flags from environment (useful for runtime config changes)."""
    global _flags
    _flags = FeatureFlags.from_env()
    return _flags