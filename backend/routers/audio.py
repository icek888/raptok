"""Audio analysis router: BPM, audio info, track analysis, beat-sync."""
import logging
from fastapi import APIRouter, HTTPException
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
    """Select fragments aligned to musical beats."""
    try:
        bpm_data = detect_bpm(req.audio_path)
        beats = bpm_data["beats"]
        starts = get_beat_aligned_starts(
            beats=beats,
            duration=req.duration,
            fragment_count=req.count,
            beat_division=req.beat_division,
        )

        fragments = []
        for i, start in enumerate(starts[:req.count]):
            frag_dur = min(req.max_frag, max(req.min_frag, 4.0))
            end = start + frag_dur
            if i + 1 < len(starts):
                end = min(starts[i + 1], start + req.max_frag)
            actual_dur = end - start
            if actual_dur < req.min_frag:
                continue
            fragments.append(Fragment(
                id=len(fragments),
                start=round(start, 3),
                end=round(end, 3),
                duration=round(actual_dur, 3),
            ))

        return BeatSyncResult(
            bpm=bpm_data["bpm"],
            beats=beats,
            fragments=fragments,
            total_duration=round(sum(f.duration for f in fragments), 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))