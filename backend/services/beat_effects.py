"""
Beat-synced video effects — zoom pulse, flash, shake on musical beats.

Generates ffmpeg filter_complex expressions that apply effects at beat timestamps.
All effects are CPU-only (ffmpeg filters), no GPU needed.

Usage:
    from services.beat_effects import build_beat_filter, has_beat_effects
    if has_beat_effects():
        filter = build_beat_filter(beats, duration, video_w=1080, video_h=1920)
"""
import logging
from typing import Optional
from services.features import get_flags

logger = logging.getLogger(__name__)


def has_beat_effects() -> bool:
    """Check if beat effects are enabled."""
    flags = get_flags()
    return flags.beat_effects_enabled and (
        flags.beat_zoom_intensity > 0
        or flags.beat_flash_intensity > 0
        or flags.beat_shake_intensity > 0
    )


def build_beat_filter(
    beats: list[float],
    duration: float,
    video_w: int = 1080,
    video_h: int = 1920,
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
) -> str:
    """
    Build ffmpeg filter expression for beat-synced effects.

    Args:
        beats: list of beat timestamps (seconds)
        duration: total video duration (seconds)
        video_w, video_h: output dimensions
        energy_curve: RMS energy values (0-1) for drop detection
        energy_times: timestamps for energy_curve

    Returns:
        ffmpeg filter_complex string that can be inserted before subtitle burn.
        Example: "zoompan=...,flash=...,shake=..."
        Returns empty string if no effects enabled.
    """
    flags = get_flags()
    if not has_beat_effects():
        return ""

    # Filter beats to duration range
    beats = [b for b in beats if 0 <= b <= duration]
    if not beats:
        return ""

    # Detect drops/peaks for flash effect
    drop_times = _detect_drops(energy_curve, energy_times) if flags.beat_flash_on_drop else beats

    parts = []

    # ── 1. Zoom pulse on every beat ──
    if flags.beat_zoom_intensity > 0:
        zoom_expr = _build_zoom_expr(beats, duration, flags.beat_zoom_intensity, video_w, video_h)
        if zoom_expr:
            parts.append(zoom_expr)

    # ── 2. Flash on drops/peaks ──
    if flags.beat_flash_intensity > 0 and drop_times:
        flash_expr = _build_flash_expr(drop_times, duration, flags.beat_flash_intensity)
        if flash_expr:
            parts.append(flash_expr)

    # ── 3. Camera shake on heavy beats ──
    if flags.beat_shake_intensity > 0:
        shake_expr = _build_shake_expr(beats, duration, flags.beat_shake_intensity, video_w, video_h)
        if shake_expr:
            parts.append(shake_expr)

    return ",".join(p for p in parts if p)


def _detect_drops(
    energy_curve: list[float] | None,
    energy_times: list[float] | None,
) -> list[float]:
    """Detect energy drop/peak moments for flash effect."""
    if not energy_curve or not energy_times or len(energy_curve) < 5:
        return []

    drops = []
    avg = sum(energy_curve) / len(energy_curve)
    for i in range(2, len(energy_curve) - 2):
        prev = energy_curve[i - 1]
        curr = energy_curve[i]
        # Sharp rise = drop coming
        if curr - prev > 0.15 and curr > avg * 1.2:
            drops.append(energy_times[i])
    return drops[:20]  # max 20 flashes


def _build_zoom_expr(
    beats: list[float],
    duration: float,
    intensity: float,
    video_w: int,
    video_h: int,
) -> str:
    """
    Build zoompan expression that pulses zoom on each beat.
    Uses ffmpeg's zoompan filter with time-based zoom expression.

    zoom = 1 + intensity * exp(-((t - beat_time) * decay)^2)
    This creates a quick zoom-in that decays back to 1.0.
    """
    if not beats:
        return ""

    # Build a sum of gaussian bumps at each beat time
    # zoom = 1 + intensity * sum(exp(-((t - beat) * 5)^2) for beat in beats)
    decay = 6.0  # how fast zoom decays (higher = faster)

    beat_terms = [f"exp(-((t-{b:.3f})*{decay})*(t-{b:.3f})*{decay})" for b in beats[:50]]
    zoom_sum = "+".join(beat_terms)
    zoom_expr = f"1+{intensity}*({zoom_sum})"

    # zoompan needs 'z' (zoom factor) and output frame count
    # We use time-based: each output frame maps to input time
    fps = 30
    total_frames = int(duration * fps)

    return (
        f"zoompan=z='{zoom_expr}':"
        f"d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"s={video_w}x{video_h}:fps={fps}"
    )


def _build_flash_expr(
    flash_times: list[float],
    duration: float,
    intensity: float,
) -> str:
    """
    Build a flash effect using colorchannelmix with time-based alpha.
    Creates a quick white flash at each timestamp.

    Uses geq filter: luma = Y + flash_amount * exp(-((t - flash_time) * 10)^2)
    """
    if not flash_times:
        return ""

    decay = 12.0
    flash_terms = [f"exp(-((t-{ft:.3f})*{decay})*(t-{ft:.3f})*{decay})" for ft in flash_times[:20]]
    flash_sum = "+".join(flash_terms)

    # geq filter: add white flash to luma channel
    # lum_expr = Y + intensity * 255 * flash_sum (clamped by ffmpeg)
    return (
        f"geq=lum='Y+{intensity * 255}*({flash_sum})':"
        f"cb='Cb':cr='Cr'"
    )


def _build_shake_expr(
    beats: list[float],
    duration: float,
    intensity: float,
    video_w: int,
    video_h: int,
) -> str:
    """
    Build camera shake effect using crop with oscillating offset.
    shake = sin(t * freq) * amplitude, applied as crop offset.
    """
    if not beats:
        return ""

    # Shake amplitude (pixels)
    shake_px = int(video_w * intensity * 0.02)  # max ~20px for intensity=1.0
    if shake_px < 2:
        return ""

    # Apply shake on every 2nd beat (not too much)
    shake_beats = beats[::2][:25]
    if not shake_beats:
        return ""

    # Build time-based shake: oscillate with decaying amplitude after each beat
    shake_terms = []
    for b in shake_beats:
        # decay envelope * sine wave
        env = f"exp(-((t-{b:.3f})*3)*(t-{b:.3f})*3)"
        shake_terms.append(f"{env}*sin(t*30)*{shake_px}")

    shake_x = "+".join(shake_terms)
    shake_y = shake_x.replace("sin(t*30)", "cos(t*25)")

    # crop with dynamic offset
    crop_w = video_w - shake_px * 4
    crop_h = video_h - shake_px * 4
    return (
        f"crop={crop_w}:{crop_h}:x='{shake_x}':y='{shake_y}',"
        f"scale={video_w}:{video_h}"
    )


def build_beat_filter_safe(
    beats: list[float],
    duration: float,
    video_w: int = 1080,
    video_h: int = 1920,
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
) -> str:
    """
    Safe wrapper — returns empty string on any error.
    Beat effects should never crash the render.
    """
    try:
        return build_beat_filter(beats, duration, video_w, video_h, energy_curve, energy_times)
    except Exception as e:
        logger.warning(f"Beat effects failed (non-fatal): {e}")
        return ""