"""
Auto-cut on beats — improved fragment selection that snaps to musical beats.

Takes existing fragments and snaps their start/end times to the nearest beat.
Also provides a "smart cut" mode that selects fragments based on energy peaks.
"""
import logging
from typing import Optional
from services.features import get_flags

logger = logging.getLogger(__name__)


def is_available() -> bool:
    """Check if auto-cut is enabled."""
    return get_flags().auto_cut_enabled


def snap_to_beats(
    fragments: list,
    beats: list[float],
    snap_start: bool = True,
    snap_end: bool = True,
    tolerance: float = 0.5,
) -> list:
    """
    Snap fragment boundaries to nearest beat positions.

    Args:
        fragments: list of Fragment objects (with .start, .end, .duration)
        beats: list of beat timestamps
        snap_start: if True, snap fragment start to nearest beat
        snap_end: if True, snap fragment end to nearest beat
        tolerance: max seconds to move a boundary (don't snap if too far)

    Returns:
        New list of Fragment-like dicts with adjusted start/end/duration.
    """
    if not beats or not fragments:
        return fragments

    flags = get_flags()
    if not flags.auto_cut_enabled:
        return fragments

    result = []
    for frag in fragments:
        start = frag.start if hasattr(frag, "start") else frag["start"]
        end = frag.end if hasattr(frag, "end") else frag["end"]
        duration = frag.duration if hasattr(frag, "duration") else frag["duration"]
        frag_id = frag.id if hasattr(frag, "id") else frag.get("id", 0)

        new_start = start
        new_end = end

        if snap_start:
            nearest = _find_nearest_beat(start, beats)
            if abs(nearest - start) <= tolerance:
                new_start = nearest

        if snap_end:
            # Find nearest beat after the fragment end
            nearest = _find_nearest_beat(end, beats)
            if abs(nearest - end) <= tolerance:
                new_end = nearest

        # Ensure minimum duration and valid range
        new_duration = new_end - new_start
        if new_duration < 1.0:
            # Keep original if snapping makes fragment too short
            new_start, new_end, new_duration = start, end, duration

        result.append({
            "id": frag_id,
            "start": round(new_start, 3),
            "end": round(new_end, 3),
            "duration": round(new_duration, 3),
        })

    logger.info(f"Auto-cut: snapped {len(result)} fragments to {len(beats)} beats")
    return result


def smart_cut(
    duration: float,
    beats: list[float],
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
    count: int = 7,
    min_frag: float = 3.0,
    max_frag: float = 6.0,
) -> list[dict]:
    """
    Smart cut: select fragments at energy peaks, snapped to beats.

    Instead of random selection, picks moments with highest energy
    and snaps their boundaries to beats.
    """
    flags = get_flags()
    if not flags.auto_cut_enabled or not beats:
        return []

    # If we have energy data, find peak moments
    peak_times = []
    if energy_curve and energy_times and len(energy_curve) > 10:
        avg = sum(energy_curve) / len(energy_curve)
        # Find peaks above average
        for i in range(2, len(energy_curve) - 2):
            if (energy_curve[i] > avg * 1.3
                and energy_curve[i] >= energy_curve[i-1]
                and energy_curve[i] >= energy_curve[i+1]):
                peak_times.append(energy_times[i])

    # If not enough peaks, use evenly spaced beats
    if len(peak_times) < count:
        # Pick evenly spaced beats
        step = max(1, len(beats) // count)
        peak_times = [beats[i] for i in range(0, len(beats), step)][:count]

    # Create fragments around each peak, snapped to beats
    fragments = []
    for i, peak in enumerate(peak_times[:count]):
        # Fragment duration: random within range, but prefer 4 beats
        frag_dur = min(max_frag, max(min_frag, 4.0))

        # Find nearest beat before peak for start
        start = _find_nearest_beat_before(peak, beats)
        # Find nearest beat after start+duration for end
        end = _find_nearest_beat_after(start + frag_dur, beats)

        actual_dur = end - start
        if actual_dur < min_frag:
            # Extend to minimum
            end = start + min_frag
            actual_dur = min_frag
        if actual_dur > max_frag:
            end = start + max_frag
            actual_dur = max_frag

        if start >= 0 and end <= duration:
            fragments.append({
                "id": len(fragments),
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(actual_dur, 3),
            })

    logger.info(f"Smart cut: {len(fragments)} fragments from {len(beats)} beats, {len(peak_times)} peaks")
    return fragments


def _find_nearest_beat(time: float, beats: list[float]) -> float:
    """Find the nearest beat timestamp to given time."""
    if not beats:
        return time
    return min(beats, key=lambda b: abs(b - time))


def _find_nearest_beat_before(time: float, beats: list[float]) -> float:
    """Find the nearest beat at or before the given time."""
    before = [b for b in beats if b <= time]
    if not before:
        return beats[0] if beats else time
    return max(before)


def _find_nearest_beat_after(time: float, beats: list[float]) -> float:
    """Find the nearest beat at or after the given time."""
    after = [b for b in beats if b >= time]
    if not after:
        return beats[-1] + 1.0 if beats else time + 1.0
    return min(after)