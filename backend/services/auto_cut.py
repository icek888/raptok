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
    
    Fragments are SCATTERED across the video — picks the most energetic moments,
    not sequential from the start. This makes the final clip dynamic.
    """
    flags = get_flags()
    if not flags.auto_cut_enabled or not beats:
        return []

    # ── Step 1: Find candidate start times from energy peaks ──
    peak_times = []
    if energy_curve and energy_times and len(energy_curve) > 10:
        avg = sum(energy_curve) / len(energy_curve)
        # Find peaks above average
        for i in range(2, len(energy_curve) - 2):
            if (energy_curve[i] > avg * 1.1
                and energy_curve[i] >= energy_curve[i-1]
                and energy_curve[i] >= energy_curve[i+1]):
                peak_times.append(energy_times[i])

    # If not enough peaks, try lower threshold
    if len(peak_times) < count and energy_curve and energy_times and len(energy_curve) > 10:
        peak_times = []
        avg = sum(energy_curve) / len(energy_curve)
        for i in range(1, len(energy_curve) - 1):
            if energy_curve[i] > avg:
                peak_times.append(energy_times[i])

    # ── If still not enough peaks → pick SCATTERED beats (not sequential) ──
    if len(peak_times) < count:
        # Pick evenly spaced beats across the WHOLE video duration
        # This ensures fragments come from different parts of the video
        step = max(1, len(beats) // count)
        peak_times = [beats[i] for i in range(0, len(beats), step)][:count]

    # ── Step 2: Sort peaks by ENERGY (highest first) to prioritize best moments ──
    # Map peaks to their energy values for sorting
    if energy_curve and energy_times and len(peak_times) > count:
        peak_energy = []
        for pt in peak_times:
            # Find closest energy sample
            best_idx = min(range(len(energy_times)), key=lambda i: abs(energy_times[i] - pt))
            peak_energy.append((pt, energy_curve[best_idx]))
        # Sort by energy descending, take top `count`
        peak_energy.sort(key=lambda x: x[1], reverse=True)
        peak_times = [pt for pt, _ in peak_energy[:count]]

    # ── Step 3: Create fragments around each peak, snapped to beats ──
    fragments = []
    for i, peak in enumerate(peak_times[:count]):
        frag_dur = min(max_frag, max(min_frag, 4.0))
        start = _find_nearest_beat_before(peak, beats)
        end = _find_nearest_beat_after(start + frag_dur, beats)

        actual_dur = end - start
        if actual_dur < min_frag:
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

    # ── De-overlap: sort by start, shift/trim overlapping fragments ──
    # Energy peaks can be close together → raw fragments overlap
    # (e.g. [25.1, 29.3] and [28.1, 32.4]). Video concat would repeat footage.
    fragments.sort(key=lambda f: f["start"])
    non_overlapping: list[dict] = []
    for frag in fragments:
        if non_overlapping:
            prev = non_overlapping[-1]
            if frag["start"] < prev["end"]:
                # Overlap with previous fragment
                if frag["end"] <= prev["end"]:
                    continue  # fully inside previous — drop
                # Shift start to prev end; keep duration if possible
                new_start = prev["end"]
                new_end = new_start + frag["duration"]
                if new_end > duration:
                    # Not enough room — trim
                    new_end = duration
                    if new_end - new_start < 1.0:
                        continue  # too short — drop
                frag = {
                    "id": 0,  # renumbered below
                    "start": round(new_start, 3),
                    "end": round(new_end, 3),
                    "duration": round(new_end - new_start, 3),
                }
        non_overlapping.append(frag)

    fragments = non_overlapping
    for i, frag in enumerate(fragments):
        frag["id"] = i

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