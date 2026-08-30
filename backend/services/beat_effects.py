"""
Beat-synced video effects — zoom pulse, flash, shake on musical beats.

Uses ffmpeg `sendcmd` + timeline approach: generates a command file with
filter parameter changes at each beat timestamp. This is the standard
ffmpeg way to apply time-varying effects and handles hundreds of beats
without expression length issues.

All effects are CPU-only (ffmpeg filters), no GPU needed.

Usage:
    from services.beat_effects import build_beat_filter, generate_beat_cmd_file
    cmd_file = generate_beat_cmd_file(beats, duration, zoom=0.08, flash=0.3, shake=0.1)
    filter = build_beat_filter(beats, duration, zoom_intensity=0.08, ...)
    # filter uses sendcmd + filter chain
"""
import os
import tempfile
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


def generate_beat_cmd_file(
    beats: list[float],
    duration: float,
    zoom_intensity: float = 0.0,
    flash_intensity: float = 0.0,
    shake_intensity: float = 0.0,
) -> str | None:
    """
    Generate a sendcmd timeline file for beat effects.

    sendcmd file format:
        [time] [flags] target command arg
    Each line: timestamp followed by filter name, command name, and value.
    Flags: 'enter' (execute at this time) is default.

    Returns path to temp file, or None if no effects.
    """
    beats = [b for b in beats if 0 <= b <= duration]
    if not beats:
        return None

    lines = []

    # ── Zoom pulse: zoompan zoom changes at each beat ──
    if zoom_intensity > 0:
        for beat in beats:
            t = f"{beat:.3f}"
            t_end = f"{min(beat + 0.15, duration):.3f}"
            lines.append(f"{t} [enter] zoompan zoom {1.0 + zoom_intensity};")
            lines.append(f"{t_end} [enter] zoompan zoom 1.0;")

    # ── Flash: eq brightness pulse ──
    if flash_intensity > 0:
        flash_beats = beats[::2]
        for beat in flash_beats:
            t = f"{beat:.3f}"
            t_end = f"{min(beat + 0.08, duration):.3f}"
            lines.append(f"{t} [enter] eq brightness {flash_intensity * 0.5};")
            lines.append(f"{t_end} [enter] eq brightness 0.0;")

    # ── Shake: crop x offset oscillation ──
    if shake_intensity > 0:
        shake_beats = beats[::2]
        shake_px = max(2, int(1080 * shake_intensity * 0.02))
        for beat in shake_beats:
            t = f"{beat:.3f}"
            t_mid = f"{min(beat + 0.05, duration):.3f}"
            t_end = f"{min(beat + 0.1, duration):.3f}"
            lines.append(f"{t} [enter] crop x {shake_px};")
            lines.append(f"{t_mid} [enter] crop x {-shake_px};")
            lines.append(f"{t_end} [enter] crop x 0;")

    if not lines:
        return None

    cmd_file = tempfile.NamedTemporaryFile(
        mode="w", suffix=".cmd", delete=False, prefix="beat_"
    )
    cmd_file.write("\n".join(lines) + "\n")
    cmd_file.close()
    logger.info(f"Beat cmd file: {len(lines)} commands for {len(beats)} beats → {cmd_file.name}")
    return cmd_file.name


def build_beat_filter(
    beats: list[float],
    duration: float,
    video_w: int = 1080,
    video_h: int = 1920,
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
    zoom_intensity: float = 0.0,
    flash_intensity: float = 0.0,
    shake_intensity: float = 0.0,
) -> str:
    """
    Build ffmpeg filter_complex expression for beat-synced effects.

    Uses sendcmd + simple filters instead of mega-expressions.
    Returns the filter chain (without [0:v] prefix and without [vfx] suffix).
    Returns empty string if no effects.
    """
    # Use explicit params if provided, else fall back to flags
    zoom_val = zoom_intensity if zoom_intensity > 0 else getattr(get_flags(), 'beat_zoom_intensity', 0)
    flash_val = flash_intensity if flash_intensity > 0 else getattr(get_flags(), 'beat_flash_intensity', 0)
    shake_val = shake_intensity if shake_intensity > 0 else getattr(get_flags(), 'beat_shake_intensity', 0)

    if zoom_val == 0 and flash_val == 0 and shake_val == 0:
        return ""

    # Filter beats to duration range
    beats = [b for b in beats if 0 <= b <= duration]
    if not beats:
        return ""

    # Generate cmd file for sendcmd
    cmd_file = generate_beat_cmd_file(
        beats, duration, zoom_val, flash_val, shake_val
    )
    if not cmd_file:
        return ""

    # Build filter chain with sendcmd
    # zoompan: default zoom=1.0, can be changed via sendcmd
    # eq: brightness=0, changed via sendcmd for flash
    # crop: x=0, changed via sendcmd for shake

    parts = []

    # Zoom pulse via zoompan (sendcmd controls 'zoom' param)
    if zoom_val > 0:
        parts.append(
            f"zoompan=z='1.0':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"s={video_w}x{video_h}:fps=30"
        )

    # Flash via eq (sendcmd controls 'brightness')
    if flash_val > 0:
        parts.append("eq=brightness=0.0:contrast=1.0:saturation=1.0")

    # Shake via crop (sendcmd controls 'x' offset)
    if shake_val > 0:
        shake_px = max(2, int(video_w * shake_val * 0.02))
        crop_w = video_w - shake_px * 4
        crop_h = video_h - shake_px * 4
        parts.append(f"crop={crop_w}:{crop_h}:x=0:y=0")
        parts.append(f"scale={video_w}:{video_h}")

    filter_chain = ",".join(parts)

    # Wrap with sendcmd
    # sendcmd reads the cmd file and applies commands at timestamps
    result = f"sendcmd=f={cmd_file},{filter_chain}"

    logger.info(f"Beat filter: sendcmd + {len(parts)} filters for {len(beats)} beats")
    return result


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
        if curr - prev > 0.15 and curr > avg * 1.2:
            drops.append(energy_times[i])
    return drops[:20]


def build_beat_filter_safe(
    beats: list[float],
    duration: float,
    video_w: int = 1080,
    video_h: int = 1920,
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
    zoom_intensity: float = 0.0,
    flash_intensity: float = 0.0,
    shake_intensity: float = 0.0,
) -> str:
    """
    Safe wrapper — returns empty string on any error.
    Beat effects should never crash the render.
    """
    try:
        return build_beat_filter(
            beats, duration, video_w, video_h,
            energy_curve, energy_times,
            zoom_intensity, flash_intensity, shake_intensity,
        )
    except Exception as e:
        logger.warning(f"Beat effects failed (non-fatal): {e}")
        return ""