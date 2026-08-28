"""BPM detection and beat tracking using librosa."""
import librosa
import numpy as np
from pathlib import Path


def detect_bpm(audio_path: str) -> dict:
    """
    Detect BPM and extract beat positions from audio file.
    
    Returns:
        {
            "bpm": float,
            "beats": list[float],  # timestamps of each beat in seconds
            "downbeats": list[float],  # estimated downbeat positions
            "duration": float,
        }
    """
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = librosa.get_duration(y=y, sr=sr)
    
    # Get tempo and beat frames
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    
    # Handle numpy array tempo (librosa can return array)
    if hasattr(tempo, '__len__'):
        tempo_val = float(tempo[0])
    else:
        tempo_val = float(tempo)
    
    # Octave error correction: if tempo > 140, it's likely doubled
    # Most songs are 60-140 BPM. Hip-hop/rap typically 70-95 BPM.
    bpm_primary = tempo_val
    bpm_half = tempo_val / 2
    bpm_double = tempo_val * 2
    
    # Auto-correct: if > 140, halve it
    if bpm_primary > 140:
        bpm_primary = bpm_half
    
    # Also check if too slow (< 50) — might need doubling
    if bpm_primary < 50:
        bpm_primary = bpm_double
    
    # Convert beat frames to timestamps
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
    
    # Estimate downbeats (every 4th beat = 1 bar in 4/4)
    # Group beats into bars
    beats_per_bar = 4
    downbeats = [beat_times[i] for i in range(0, len(beat_times), beats_per_bar)]
    
    return {
        "bpm": round(bpm_primary, 1),
        "bpm_raw": round(tempo_val, 1),
        "bpm_half": round(bpm_half, 1),
        "bpm_double": round(bpm_double, 1),
        "beats": [round(b, 3) for b in beat_times],
        "downbeats": [round(d, 3) for d in downbeats],
        "duration": round(float(duration), 2),
    }


def get_beat_aligned_starts(
    beats: list[float],
    duration: float,
    fragment_count: int,
    beat_division: str = "1/4",
) -> list[float]:
    """
    Generate beat-aligned start positions for fragments.
    
    beat_division options:
        "1/1" — every bar (downbeat)
        "1/2" — every half bar (beat 1 and 3)
        "1/4" — every beat
        "1/8" — every half beat
        "1/16" — every quarter beat
    """
    if not beats:
        return []
    
    division_map = {
        "1/1": 4,   # every 4th beat = 1 bar
        "1/2": 2,   # every 2nd beat
        "1/4": 1,   # every beat
        "1/8": 0.5, # every half beat (interpolated)
        "1/16": 0.25,  # every quarter beat
    }
    
    step = division_map.get(beat_division, 1)
    
    if step >= 1:
        # Use actual beat positions
        indices = np.arange(0, len(beats), step, dtype=int)
        starts = [beats[i] for i in indices if beats[i] < duration]
    else:
        # Interpolate between beats for finer divisions
        starts = []
        for i in range(len(beats) - 1):
            beat_start = beats[i]
            beat_end = beats[i + 1]
            sub_steps = int(1 / step)
            for j in range(sub_steps):
                t = beat_start + (beat_end - beat_start) * j / sub_steps
                if t < duration:
                    starts.append(round(t, 3))
        starts.append(beats[-1])
    
    return starts