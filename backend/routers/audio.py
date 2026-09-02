"""Audio analysis router: BPM, audio info, track analysis, beat-sync."""
import logging
from fastapi import APIRouter, Form, HTTPException
from models.schemas import BPMRequest, BPMResult, BeatSyncRequest, BeatSyncResult, Fragment
from services.bpm_detector import detect_bpm, get_beat_aligned_starts
from services.audio_analyzer import analyze_track

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/bpm", response_model=BPMResult)
async def api_detect_bpm(req: BPMRequest):
    """Detect BPM and extract beat positions from audio."""
    try:
        return detect_bpm(req.audio_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/audio-info")
async def api_audio_info(req: BPMRequest):
    """Get audio file info: duration, BPM, suggested fragment range."""
    try:
        import librosa
        y, sr = librosa.load(req.audio_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        bpm_data = detect_bpm(req.audio_path)

        # Find the most energetic window (up to 60s)
        hop_length = 512
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0]
        rms_times = librosa.frames_to_time(
            range(len(rms)), sr=sr, hop_length=hop_length
        ).tolist()

        target_window = min(60.0, duration)
        if duration <= target_window:
            best_start, best_end = 0.0, duration
        else:
            best_start, best_energy = 0.0, 0.0
            for start_t in range(0, int(duration - target_window)):
                end_t = start_t + target_window
                start_idx = int(start_t * sr / hop_length)
                end_idx = int(end_t * sr / hop_length)
                if end_idx > len(rms):
                    break
                energy = float(rms[start_idx:end_idx].mean())
                if energy > best_energy:
                    best_energy = energy
                    best_start = float(start_t)
            best_end = best_start + target_window

        return {
            "duration": round(float(duration), 2),
            "bpm": bpm_data["bpm"],
            "beats": bpm_data["beats"],
            "suggested_start": round(best_start, 2),
            "suggested_end": round(best_end, 2),
            "rms_times": [round(t, 3) for t in rms_times[::50]],
            "rms_values": [round(float(v), 4) for v in rms[::50]],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/track-analysis")
async def api_track_analysis(req: BPMRequest):
    """Deep audio analysis: mood, energy profile, genre hint, hook detection."""
    try:
        return analyze_track(req.audio_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/beat-sync", response_model=BeatSyncResult)
async def api_beat_sync(req: BeatSyncRequest):
    """Select fragments aligned to musical beats, scattered across video.
    
    v3: clip_start/clip_length define the target duration (from Lyrics step).
    Fragments are picked from SCATTERED beat positions across the video, not sequential.
    """
    try:
        bpm_data = detect_bpm(req.audio_path)
        all_beats = bpm_data["beats"]
        bpm = bpm_data["bpm"]
        
        # v3: target duration = clip_length if provided, else video duration
        target_duration = req.clip_length if req.clip_length > 0 else req.duration
        
        # Filter beats to clip range + shift to 0-based
        if req.clip_start > 0 and req.clip_length > 0:
            clip_end = req.clip_start + req.clip_length
            beats = [b for b in all_beats if req.clip_start <= b <= clip_end]
            beats = [round(b - req.clip_start, 3) for b in beats]
        else:
            beats = all_beats
        
        # ── Get SCATTERED beat positions across video duration ──
        # Instead of sequential from start, pick evenly spaced across the whole video
        starts = get_beat_aligned_starts(
            beats=beats,
            duration=req.duration,  # video duration (fragments come from video)
            fragment_count=req.count,
            beat_division=req.beat_division,
        )
        
        # ── Scatter: pick starts spread across the video, not from the beginning ──
        if len(starts) > req.count:
            # Pick evenly spaced starts across the full video
            step = len(starts) // req.count
            scattered = [starts[i * step] for i in range(req.count)]
            starts = scattered

        fragments = []
        for i, start in enumerate(starts[:req.count]):
            frag_dur = min(req.max_frag, max(req.min_frag, 4.0))
            end = start + frag_dur
            if i + 1 < len(starts):
                end = min(starts[i + 1], start + req.max_frag)
            actual_dur = end - start
            if actual_dur < req.min_frag:
                continue
            # Clamp to video duration
            if end > req.duration:
                end = req.duration
                actual_dur = end - start
                if actual_dur < req.min_frag:
                    continue
            fragments.append(Fragment(
                id=len(fragments),
                start=round(start, 3),
                end=round(end, 3),
                duration=round(actual_dur, 3),
            ))

        # ── Loop fragments if total < target_duration (video shorter than clip) ──
        if fragments and target_duration > 0:
            total = sum(f.duration for f in fragments)
            if total < target_duration:
                cycled = list(fragments)
                i = 0
                while sum(f.duration for f in cycled) < target_duration:
                    src = fragments[i % len(fragments)]
                    cycled.append(Fragment(
                        id=len(cycled),
                        start=src.start,
                        end=src.end,
                        duration=src.duration,
                    ))
                    i += 1
                    if i > 50:
                        break
                fragments = cycled

        # Trim to target
        if fragments:
            total = sum(f.duration for f in fragments)
            if total > target_duration:
                excess = total - target_duration
                last = fragments[-1]
                last.end = round(last.end - excess, 3)
                last.duration = round(last.duration - excess, 3)

        # Renumber
        for i, f in enumerate(fragments):
            f.id = i

        return BeatSyncResult(
            bpm=bpm,
            beats=beats,
            fragments=fragments,
            total_duration=round(sum(f.duration for f in fragments), 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/auto-cut-by-audio")
async def api_auto_cut_by_audio(
    audio_path: str = Form(...),
    video_duration: float = Form(...),
    min_frag: float = Form(3.0),
    max_frag: float = Form(6.0),
    clip_start: float = Form(0.0),
    clip_length: float = Form(0.0),
):
    """
    Auto-cut video into fragments that exactly match audio duration.
    Uses beats + energy peaks. Fragment count is auto-calculated from
    audio duration and BPM.

    If clip_start/clip_length provided, fragments match only that part
    of the track (selected on the Lyrics timeline), and word timings
    stay aligned to the full track.
    """
    try:
        import librosa
        from services.auto_cut import smart_cut, snap_to_beats

        # Get audio duration
        audio_duration = librosa.get_duration(path=audio_path)

        # If clip range provided, that defines the target duration
        target_duration = clip_length if clip_length > 0 else audio_duration

        # Get BPM + beats — filter beats to clip range for accurate snapping
        bpm_data = detect_bpm(audio_path)
        all_beats = bpm_data["beats"]
        bpm = bpm_data["bpm"]
        # Filter beats to clip range: [clip_start, clip_start + target_duration]
        if clip_start > 0 and target_duration > 0:
            clip_end_time = clip_start + target_duration
            beats = [b for b in all_beats if clip_start <= b <= clip_end_time]
            # Shift beats to 0-based (relative to clip start)
            beats = [round(b - clip_start, 3) for b in beats]
        else:
            beats = all_beats

        # Get energy curve — filter to clip range
        try:
            track_data = analyze_track(audio_path)
            all_energy = track_data.get("energy_curve", [])
            all_energy_times = track_data.get("energy_times", [])
            # Filter to clip range
            if clip_start > 0 and target_duration > 0:
                clip_end_time = clip_start + target_duration
                energy_curve = []
                energy_times = []
                for i, t in enumerate(all_energy_times):
                    if clip_start <= t <= clip_end_time:
                        energy_curve.append(all_energy[i])
                        energy_times.append(round(t - clip_start, 3))
            else:
                energy_curve = all_energy
                energy_times = all_energy_times
        except Exception:
            energy_curve = []
            energy_times = []

        # Auto-calculate fragment count:
        # beats_per_fragment = 8 (2 bars at 4/4)
        # fragment_duration ≈ 8 * 60/bpm
        # count = target_duration / fragment_duration
        if bpm > 0:
            beats_per_frag = 8
            ideal_frag_dur = beats_per_frag * 60.0 / bpm
            ideal_frag_dur = max(min_frag, min(max_frag, ideal_frag_dur))
            count = max(3, min(12, int(target_duration / ideal_frag_dur)))
        else:
            ideal_frag_dur = (min_frag + max_frag) / 2
            count = max(3, min(12, int(target_duration / ideal_frag_dur)))

        # Use smart_cut to get fragments from energy peaks + beats
        # Note: smart_cut selects within video_duration (can't pick footage that doesn't exist)
        fragments = smart_cut(
            duration=video_duration,
            beats=beats,
            energy_curve=energy_curve,
            energy_times=energy_times,
            count=count,
            min_frag=min_frag,
            max_frag=max_frag,
        )

        # Snap to beats
        if fragments and beats:
            fragments = snap_to_beats(fragments, beats)

        # ── If video is shorter than clip range → loop fragments to fill target ──
        # v3: audio defines the clip length, video adapts (loop/repeat footage)
        if fragments and target_duration > 0:
            total = sum(f["duration"] for f in fragments)
            if total < target_duration:
                # Cycle fragments until we reach target_duration
                cycled = list(fragments)
                i = 0
                while sum(f["duration"] for f in cycled) < target_duration:
                    src = fragments[i % len(fragments)]
                    cycled.append({
                        "id": len(cycled),
                        "start": src["start"],
                        "end": src["end"],
                        "duration": src["duration"],
                    })
                    i += 1
                    if i > 50:  # safety limit
                        break
                fragments = cycled

        # Ensure total duration matches target duration (trim last fragment)
        if fragments:
            total = sum(f["duration"] for f in fragments)
            if total > target_duration:
                excess = total - target_duration
                last = fragments[-1]
                last["end"] = round(last["end"] - excess, 3)
                last["duration"] = round(last["duration"] - excess, 3)

        # Renumber
        for i, f in enumerate(fragments):
            f["id"] = i

        return {
            "fragments": fragments,
            "total_duration": round(sum(f["duration"] for f in fragments), 2),
            "audio_duration": round(audio_duration, 2),
            "clip_start": round(clip_start, 2),
            "clip_length": round(target_duration, 2),
            "bpm": bpm,
            "beats": beats,
            "count": len(fragments),
            "energy_curve": energy_curve,
            "energy_times": energy_times,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))