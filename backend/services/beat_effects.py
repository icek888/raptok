"""
Beat-synced video effects — zoom pulse, flash, shake on musical beats.

Key ffmpeg facts:
- zoompan: uses 'on' (output frame number), NOT 't'. Use on/fps for time.
- eq: supports timeline via 'enable' option. Uses 't' for time.
- crop: supports 't' in x/y expressions.
- geq: NOT used (variable issues). eq+brightness is better for flash.
- In filter_complex: commas separate filters. Commas inside expressions
  (like pow(x,2)) must be avoided or escaped. We use (x)*(x) instead of pow(x,2).

All effects are CPU-only (ffmpeg filters), no GPU needed.
"""
import logging
from services.features import get_flags

logger = logging.getLogger(__name__)

MAX_BEATS_IN_EXPR = 50


def has_beat_effects() -> bool:
    flags = get_flags()
    return flags.beat_effects_enabled and (
        flags.beat_zoom_intensity > 0
        or flags.beat_flash_intensity > 0
        or flags.beat_shake_intensity > 0
    )


def _sq(x: str) -> str:
    """Square without pow() — avoids comma in filter expressions."""
    return f"({x})*({x})"


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
    """Build ffmpeg filter chain for beat effects. Returns filters only."""
    zoom_val = zoom_intensity if zoom_intensity > 0 else getattr(get_flags(), 'beat_zoom_intensity', 0)
    flash_val = flash_intensity if flash_intensity > 0 else getattr(get_flags(), 'beat_flash_intensity', 0)
    shake_val = shake_intensity if shake_intensity > 0 else getattr(get_flags(), 'beat_shake_intensity', 0)

    if zoom_val == 0 and flash_val == 0 and shake_val == 0:
        return ""

    beats = [b for b in beats if 0 <= b <= duration]
    if not beats:
        return ""

    use_periodic = len(beats) > MAX_BEATS_IN_EXPR

    parts = []

    if zoom_val > 0:
        expr = _build_zoom(beats, duration, zoom_val, video_w, video_h, use_periodic)
        if expr:
            parts.append(expr)

    if flash_val > 0:
        expr = _build_flash(beats, duration, flash_val, use_periodic)
        if expr:
            parts.append(expr)

    if shake_val > 0:
        expr = _build_shake(beats, duration, shake_val, video_w, video_h, use_periodic)
        if expr:
            parts.append(expr)

    result = ",".join(p for p in parts if p)
    if result:
        mode = "periodic" if use_periodic else f"explicit({min(len(beats), MAX_BEATS_IN_EXPR)})"
        logger.info(f"Beat filter ({mode}): {len(parts)} effects for {len(beats)} beats")
    return result


def _build_zoom(
    beats: list[float],
    duration: float,
    intensity: float,
    video_w: int,
    video_h: int,
    use_periodic: bool,
) -> str:
    """
    zoompan filter — zoom pulse on each beat.
    Uses 'on' (output frame number) for time. on/fps = time in seconds.
    """
    decay = 8.0
    fps = 30

    if use_periodic:
        if len(beats) < 2:
            return ""
        interval = (beats[-1] - beats[0]) / (len(beats) - 1)
        # on/fps mod interval — but zoompan doesn't have mod()
        # Use periodic gaussian: exp(-((on/fps mod interval) * decay)^2)
        # Without mod, use: exp(-((on/fps - floor(on/fps/interval)*interval) * decay)^2)
        t_expr = f"on/{fps}"
        mod_expr = f"{t_expr}-{interval:.4f}*floor({t_expr}/{interval:.4f})"
        zoom_expr = f"1+{intensity}*exp(-{_sq(f'{mod_expr}*{decay}')})"
    else:
        selected = beats[:MAX_BEATS_IN_EXPR]
        # Use on/fps for time
        t_expr = f"on/{fps}"
        terms = [f"exp(-{_sq(f'({t_expr}-{b:.3f})*{decay}')})" for b in selected]
        zoom_expr = f"1+{intensity}*({'+'.join(terms)})"

    return (
        f"zoompan=z='{zoom_expr}':"
        f"d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"s={video_w}x{video_h}:fps={fps}"
    )


def _build_flash(
    beats: list[float],
    duration: float,
    intensity: float,
    use_periodic: bool,
) -> str:
    """
    eq filter with enable timeline — brightness flash on beats.
    eq supports timeline via 'enable' option. Uses 't' for time.
    enable='between(t,beat-0.04,beat+0.04)' — flash on for 0.08s at each beat.
    """
    flash_val = intensity * 0.5  # eq brightness range is -1.0 to 1.0

    if use_periodic:
        if len(beats) < 2:
            return ""
        interval = (beats[-1] - beats[0]) / (len(beats) - 1)
        # Periodic flash every 2 beats
        period = interval * 2
        # enable = 1 when t is within 0.04s of each beat (mod period)
        # between(t, t_floor + period - 0.04, t_floor + period + 0.04)
        # Simplify: enable=gt(0.04, abs(t - floor(t/period)*period - period))
        enable_expr = f"gt(0.04\,abs(t-floor(t/{period:.4f})*{period:.4f}-{period:.4f}))"
        return f"eq=brightness={flash_val:.2f}:enable='{enable_expr}'"
    else:
        flash_beats = beats[::2][:25]
        if not flash_beats:
            return ""
        # Build enable expression: OR of between(t, beat-0.04, beat+0.04) for each beat
        terms = [f"between(t\,{b-0.04:.3f}\,{b+0.04:.3f})" for b in flash_beats]
        enable_expr = "+".join(terms)  # + acts as OR (any nonzero = enabled)
        return f"eq=brightness={flash_val:.2f}:enable='{enable_expr}'"


def _build_shake(
    beats: list[float],
    duration: float,
    intensity: float,
    video_w: int,
    video_h: int,
    use_periodic: bool,
) -> str:
    """
    crop + scale — camera shake on beats.
    crop supports 't' in x/y expressions.
    """
    shake_px = max(2, int(video_w * intensity * 0.02))
    if shake_px < 2:
        return ""

    if use_periodic:
        if len(beats) < 2:
            return ""
        interval = (beats[-1] - beats[0]) / (len(beats) - 1)
        period = f"{interval * 2:.4f}"
        # Periodic shake envelope
        mod_expr = f"t-{period}*floor(t/{period})"
        env = f"exp(-{_sq(f'{mod_expr}*3')})"
        shake_x = f"{shake_px}*{env}*sin(t*30)"
        shake_y = f"{shake_px}*{env}*cos(t*25)"
    else:
        shake_beats = beats[::2][:20]
        if not shake_beats:
            return ""
        x_terms = [f"exp(-{_sq(f'(t-{b:.3f})*3')})*sin(t*30)*{shake_px}" for b in shake_beats]
        y_terms = [f"exp(-{_sq(f'(t-{b:.3f})*3')})*cos(t*25)*{shake_px}" for b in shake_beats]
        shake_x = "+".join(x_terms)
        shake_y = "+".join(y_terms)

    crop_w = video_w - shake_px * 4
    crop_h = video_h - shake_px * 4
    return f"crop={crop_w}:{crop_h}:x='{shake_x}':y='{shake_y}',scale={video_w}:{video_h}"


def _detect_drops(
    energy_curve: list[float] | None,
    energy_times: list[float] | None,
) -> list[float]:
    if not energy_curve or not energy_times or len(energy_curve) < 5:
        return []
    drops = []
    avg = sum(energy_curve) / len(energy_curve)
    for i in range(2, len(energy_curve) - 2):
        if energy_curve[i] - energy_curve[i - 1] > 0.15 and energy_curve[i] > avg * 1.2:
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
    """Safe wrapper — returns empty string on any error."""
    try:
        return build_beat_filter(
            beats, duration, video_w, video_h,
            energy_curve, energy_times,
            zoom_intensity, flash_intensity, shake_intensity,
        )
    except Exception as e:
        logger.warning(f"Beat effects failed (non-fatal): {e}")
        return ""