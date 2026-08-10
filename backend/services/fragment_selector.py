"""Fragment selector — picks random 3-5s clips from video."""
import random
from models.schemas import Fragment


def select_fragments(
    duration: float,
    count: int = 7,
    min_frag: float = 3.0,
    max_frag: float = 5.0,
    seed: int | None = None,
) -> list[Fragment]:
    """
    Select `count` random fragments from a video of `duration` seconds.
    Each fragment is between min_frag and max_frag seconds.
    Fragments are spread across the video (no clustering).
    """
    if seed is not None:
        random.seed(seed)
    
    if duration < count * min_frag:
        # Video too short — reduce count
        count = max(3, int(duration / min_frag))
    
    # Divide timeline into N equal segments, pick one random point from each
    segment_size = duration / count
    fragments = []
    
    for i in range(count):
        seg_start = i * segment_size
        seg_end = (i + 1) * segment_size
        
        # Pick a random point within the segment (with margin for fragment duration)
        frag_dur = random.uniform(min_frag, max_frag)
        margin = frag_dur / 2
        pick_point = random.uniform(seg_start + margin, seg_end - margin)
        
        frag_start = max(0, pick_point - frag_dur / 2)
        frag_end = min(duration, frag_start + frag_dur)
        frag_start = frag_end - frag_dur  # adjust start if we hit the end
        
        fragments.append(Fragment(
            id=i,
            start=round(frag_start, 2),
            end=round(frag_end, 2),
            duration=round(frag_dur, 2),
        ))
    
    return fragments


def replace_fragment(
    duration: float,
    fragments: list[Fragment],
    fragment_id: int,
    new_start: float,
    frag_duration: float = 4.0,
) -> list[Fragment]:
    """Replace a specific fragment with a new start time."""
    new_start = max(0, min(new_start, duration - frag_duration))
    
    result = []
    for f in fragments:
        if f.id == fragment_id:
            result.append(Fragment(
                id=f.id,
                start=round(new_start, 2),
                end=round(new_start + frag_duration, 2),
                duration=round(frag_duration, 2),
            ))
        else:
            result.append(f)
    
    return result


def get_total_duration(fragments: list[Fragment]) -> float:
    return round(sum(f.duration for f in fragments), 2)