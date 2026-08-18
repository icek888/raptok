"""RapTok API — main FastAPI app."""
import os
import shutil
import logging
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from config import TEMP_DIR, OUTPUT_DIR
from models.schemas import (
    AnalyzeRequest, VideoInfo, FragmentSelectRequest, Fragment,
    FragmentReplaceRequest, SubtitleRequest, SubtitleLine,
    RenderRequest, RenderStatus, SubtitleStyle,
    BPMRequest, BPMResult, BeatSyncRequest, BeatSyncResult,
    TranscribeRequest, TranscribeResult,
    WordTiming, WordSubtitleRequest, SubtitleAdjustRequest,
)
from services.downloader import download_video
from services.fragment_selector import select_fragments, replace_fragment, get_total_duration
from services.thumbnail_generator import get_thumbnail
from services.subtitle_generator import split_lyrics, split_lyrics_word_level, generate_ass
from services.video_renderer import render_clip
from services.bpm_detector import detect_bpm, get_beat_aligned_starts
from services.speech_recognizer import transcribe_to_lyrics

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="RapTok API", version="0.1.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job storage (MVP — no DB)
_jobs: dict = {}


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "raptok", "version": "0.1.0"}


@app.get("/api/templates")
async def get_templates():
    """Return available render templates."""
    from models.schemas import TEMPLATES
    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "font": t.font,
                "size": t.size,
                "primary_color": t.primary_color,
                "active_color": t.active_color,
                "position": t.position,
                "display_mode": t.display_mode,
                "video_mode": t.video_mode,
                "blur_sigma": t.blur_sigma,
                "dark_overlay": t.dark_overlay,
                "scale_factor": t.scale_factor,
            }
            for t in TEMPLATES
        ]
    }


@app.post("/api/analyze", response_model=VideoInfo)
async def analyze_video(req: AnalyzeRequest):
    """Download video and return metadata."""
    try:
        info = download_video(req.url)
        _jobs[info["job_id"]] = {"video": info, "status": "analyzed"}
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/fragments/select")
async def api_select_fragments(req: FragmentSelectRequest):
    """Select random fragments from video."""
    fragments = select_fragments(
        duration=req.duration,
        count=req.count,
        min_frag=req.min_frag,
        max_frag=req.max_frag,
        seed=req.seed,
    )
    return {
        "fragments": [f.model_dump() for f in fragments],
        "total_duration": get_total_duration(fragments),
    }


@app.post("/api/fragments/replace")
async def api_replace_fragment(req: FragmentReplaceRequest):
    """Replace a specific fragment with new start time."""
    fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
    result = replace_fragment(
        duration=req.duration,
        fragments=fragments,
        fragment_id=req.fragment_id,
        new_start=req.new_start,
        frag_duration=req.frag_duration,
    )
    return {
        "fragments": [f.model_dump() for f in result],
        "total_duration": get_total_duration(result),
    }


@app.post("/api/thumbnails")
async def api_get_thumbnails(video_path: str = Form(...), timestamps: str = Form(...)):
    """Get thumbnails for multiple timestamps."""
    ts_list = [float(t) for t in timestamps.split(",")]
    thumbnails = []
    for i, ts in enumerate(ts_list):
        try:
            thumb = get_thumbnail(video_path, ts, f"thumb_{i}")
            thumbnails.append({"index": i, "timestamp": ts, "path": thumb})
        except Exception as e:
            thumbnails.append({"index": i, "timestamp": ts, "error": str(e)})
    return {"thumbnails": thumbnails}


@app.post("/api/subtitles/split")
async def api_split_subtitles(req: SubtitleRequest):
    """Split lyrics into subtitle lines mapped to fragments."""
    fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
    subtitles = split_lyrics(req.lyrics, fragments)
    return {"subtitles": [s.model_dump() for s in subtitles]}


@app.post("/api/render")
async def api_render(req: RenderRequest):
    """Render the final TikTok clip."""
    try:
        fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
        subtitles = [SubtitleLine(**s) if isinstance(s, dict) else s for s in req.subtitles]
        
        # Resolve template if provided
        template_dict = None
        if req.template_id:
            from models.schemas import TEMPLATES
            tmpl = next((t for t in TEMPLATES if t.id == req.template_id), None)
            if tmpl:
                template_dict = tmpl.model_dump()
                # ── Override style + display_mode from template ──
                req.style = SubtitleStyle(
                    font=tmpl.font,
                    size=tmpl.size,
                    primary_color=tmpl.primary_color,
                    active_color=tmpl.active_color,
                    outline_color=tmpl.outline_color,
                    outline_width=tmpl.outline_width,
                    position=tmpl.position,
                    margin_v=tmpl.margin_v,
                    bold=tmpl.bold,
                )
                req.display_mode = tmpl.display_mode
                req.karaoke = tmpl.karaoke
                logger.info(f"Template applied: {tmpl.name} — font={tmpl.font}, size={tmpl.size}, mode={tmpl.display_mode}, video_mode={tmpl.video_mode}")
            else:
                logger.warning(f"Template not found: {req.template_id}")
        
        # DEBUG: Log what we receive
        words_count = sum(len(s.words) for s in subtitles if s.words)
        logger.info(f"Render: {len(subtitles)} subs, {words_count} words, template={req.template_id or 'none'}")
        for i, s in enumerate(subtitles[:3]):
            logger.info(f"  sub[{i}]: text='{s.text[:30]}', words={len(s.words) if s.words else 0}")
        
        # If audio_start is set, extract the fragment from audio first
        audio_path = req.audio_path
        if req.audio_start > 0:
            # Calculate total video duration
            total_dur = sum(f.duration for f in fragments)
            # Extract audio fragment
            import tempfile
            import subprocess
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp_audio = tmp.name
            subprocess.run([
                "ffmpeg", "-y", "-i", req.audio_path,
                "-ss", str(req.audio_start), "-t", str(total_dur + 1),
                "-ar", "44100", "-ac", "2", tmp_audio
            ], capture_output=True, timeout=120)
            audio_path = tmp_audio
        
        output_path = render_clip(
            video_path=req.video_path,
            fragments=fragments,
            audio_path=audio_path,
            subtitles=subtitles,
            style=req.style,
            karaoke=req.karaoke,
            display_mode=req.display_mode,
            template=template_dict,
        )
        
        # Cleanup temp audio
        if req.audio_start > 0:
            try:
                if os.path.exists(tmp_audio):
                    os.unlink(tmp_audio)
            except Exception:
                pass
        
        return {
            "status": "completed",
            "output_path": output_path,
            "filename": os.path.basename(output_path),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file (mp3)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    job_id = f"audio_{os.urandom(6).hex()}"
    audio_path = TEMP_DIR / f"{job_id}_{file.filename}"
    
    with open(audio_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    
    return {"path": str(audio_path), "filename": file.filename, "size": os.path.getsize(audio_path)}


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """Download a rendered clip."""
    filepath = OUTPUT_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(filepath), media_type="video/mp4", filename=filename)


@app.get("/api/thumbnail/{filename}")
async def get_thumbnail_file(filename: str):
    """Serve a thumbnail image."""
    filepath = TEMP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(filepath), media_type="image/jpeg")


# ─── Audio preview endpoint ───

@app.get("/api/audio-preview/{filename}")
async def audio_preview(filename: str):
    """Serve audio file for preview playback."""
    # Search in temp dir
    for f in TEMP_DIR.iterdir():
        if filename in f.name:
            return FileResponse(str(f), media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Audio file not found")


# ─── BPM Detection ───

@app.post("/api/bpm", response_model=BPMResult)
async def api_detect_bpm(req: BPMRequest):
    """Detect BPM and extract beat positions from audio."""
    try:
        result = detect_bpm(req.audio_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Audio Info (duration, waveform preview) ───

@app.post("/api/audio-info")
async def api_audio_info(req: BPMRequest):
    """Get audio file info: duration, BPM, suggested fragment range."""
    try:
        import librosa
        y, sr = librosa.load(req.audio_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Get BPM
        bpm_data = detect_bpm(req.audio_path)
        
        # Find the "energy peaks" — sections with most vocals/music
        # Use RMS energy to find the best 30-second segment
        hop_length = 512
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop_length)[0]
        rms_times = librosa.frames_to_time(
            range(len(rms)), sr=sr, hop_length=hop_length
        ).tolist()
        
        # Find the most energetic window (up to 60s, or full track if shorter)
        target_window = min(60.0, duration)
        if duration <= target_window:
            best_start = 0.0
            best_end = duration
        else:
            best_start = 0.0
            best_energy = 0.0
            step = 1.0  # check every 1 second
            for start_t in range(0, int(duration - target_window), int(step)):
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
            "rms_times": [round(t, 3) for t in rms_times[::50]],  # downsample
            "rms_values": [round(float(v), 4) for v in rms[::50]],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Beat-Synced Fragment Selection ───

@app.post("/api/beat-sync", response_model=BeatSyncResult)
async def api_beat_sync(req: BeatSyncRequest):
    """Select fragments aligned to musical beats."""
    try:
        bpm_data = detect_bpm(req.audio_path)
        beats = bpm_data["beats"]
        
        # Get beat-aligned start positions
        starts = get_beat_aligned_starts(
            beats=beats,
            duration=req.duration,
            fragment_count=req.count,
            beat_division=req.beat_division,
        )
        
        # Create fragments from starts
        fragments = []
        for i, start in enumerate(starts[:req.count]):
            # Duration: pick random within min/max, but snap to next beat
            frag_dur = min(req.max_frag, max(req.min_frag, 4.0))
            
            # Try to snap end to nearest beat
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
        
        total_dur = sum(f.duration for f in fragments)
        
        return BeatSyncResult(
            bpm=bpm_data["bpm"],
            beats=beats,
            fragments=fragments,
            total_duration=round(total_dur, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Speech Recognition (Auto-transcribe lyrics) ───

@app.post("/api/transcribe", response_model=TranscribeResult)
async def api_transcribe(req: TranscribeRequest):
    """Transcribe audio and get word-level lyrics with timestamps."""
    try:
        result = transcribe_to_lyrics(req.audio_path, language=req.language)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Full transcription (transcribe entire audio once) ───

@app.post("/api/transcribe-full")
async def api_transcribe_full(
    audio_path: str = Form(...),
    language: str = Form("en"),
    lyrics: str = Form(""),
    model_size: str = Form(""),
):
    """Transcribe ENTIRE audio track once. Returns absolute word timestamps.
    
    Frontend can then filter words by any selected range without re-calling this endpoint.
    If lyrics provided, forced alignment is applied to the full track.
    """
    try:
        from services.speech_recognizer import transcribe_audio
        from services.forced_alignment import merge_transcription_with_lyrics, align_lyrics_to_timings
        from services.bpm_detector import detect_bpm
        from services.stem_separator import separate_vocals
        
        # ── Step 1: Separate vocals from the full mix ──
        # Whisper works much better on isolated vocals — no music interference
        # = cleaner word boundaries, fewer missed words, tighter timestamps
        try:
            vocal_path = await separate_vocals(audio_path, method="auto")
            whisper_input = vocal_path  # Use isolated vocals
            logger.info(f"Using isolated vocals for whisper: {vocal_path}")
        except Exception as e:
            logger.warning(f"Stem separation failed ({e}), using original audio")
            whisper_input = audio_path  # Fallback to original
        
        # ── Step 2: WhisperX transcribe + align (wav2vec2 built-in) ──
        # If user provided lyrics, WhisperX aligns them directly (no whisper transcription needed)
        # If no lyrics, WhisperX transcribes and aligns in one step
        whisper_result = transcribe_audio(whisper_input, language=language, word_timestamps=True, lyrics=lyrics, model_size=model_size)
        
        user_lyrics = lyrics.strip() if lyrics else ""
        
        if user_lyrics:
            # User provided lyrics — map them to whisperx aligned words via DTW
            try:
                bpm_result = detect_bpm(audio_path)
                full_bpm = bpm_result.get("bpm", 0.0)
                full_beats = bpm_result.get("beats", [])
            except Exception:
                full_bpm = 0.0
                full_beats = []
            
            import librosa
            full_duration = librosa.get_duration(path=audio_path)
            
            whisper_words = whisper_result.get("words", [])
            # DTW: map user lyrics onto whisperx word timestamps
            word_timings = align_lyrics_to_timings(user_lyrics, whisper_words)
            
            return {
                "text": user_lyrics,
                "words": [w.model_dump() if hasattr(w, 'model_dump') else w for w in word_timings],
                "language": whisper_result.get("language", "unknown"),
                "method": "whisperx_alignment",
                "whisper_words": len(whisper_words),
                "aligned_words": len(word_timings),
                "bpm": full_bpm,
                "total_duration": round(full_duration, 2),
            }
        else:
            # No lyrics — return whisperx's own transcription with aligned timestamps
            words = whisper_result.get("words", [])
            return {
                "text": whisper_result.get("text", ""),
                "words": words,
                "language": whisper_result.get("language", "unknown"),
                "method": "whisperx_only",
            }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Transcribe with fragment selection + forced alignment (LEGACY) ───

@app.post("/api/transcribe-fragment")
async def api_transcribe_fragment(
    audio_path: str = Form(...),
    language: str = Form("en"),
    start: float = Form(0.0),
    end: float = Form(0.0),
    lyrics: str = Form(""),
):
    """Transcribe audio fragment and align with user-provided lyrics."""
    try:
        import tempfile
        import subprocess
        
        # Extract fragment with ffmpeg
        tmp_fragment = None
        fragment_path = audio_path
        
        if end > start:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp_fragment = tmp.name
            
            duration = end - start
            subprocess.run([
                "ffmpeg", "-y", "-i", audio_path,
                "-ss", str(start), "-t", str(duration),
                "-ar", "16000", "-ac", "1", tmp_fragment
            ], capture_output=True, timeout=120)
            fragment_path = tmp_fragment
        
        # Transcribe
        from services.speech_recognizer import transcribe_audio
        whisper_result = transcribe_audio(
            fragment_path, language=language, word_timestamps=True
        )
        
        # Cleanup
        if tmp_fragment and os.path.exists(tmp_fragment):
            os.unlink(tmp_fragment)
        
        user_lyrics = lyrics.strip() if lyrics else ""
        
        if user_lyrics:
            # Forced alignment: use whisper timing + user's lyrics
            # NOTE: audio fragment was already extracted, so whisper timestamps
            # are 0-based (relative to fragment start = video timeline).
            from services.forced_alignment import merge_transcription_with_lyrics
            from services.bpm_detector import detect_bpm
            
            # Calculate actual fragment duration
            frag_dur = 0.0
            if end > start:
                frag_dur = end - start
            else:
                import subprocess as sp
                try:
                    probe = sp.run(
                        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                         "-of", "default=noprint_wrappers=1:nokey=1", fragment_path],
                        capture_output=True, text=True, timeout=30,
                    )
                    frag_dur = float(probe.stdout.strip())
                except Exception:
                    frag_dur = 0.0
            
            # Get BPM and beats for beat-aware distribution
            try:
                bpm_result = detect_bpm(fragment_path if fragment_path != audio_path else audio_path)
                frag_bpm = bpm_result.get("bpm", 0.0)
                frag_beats = bpm_result.get("beats", [])
            except Exception:
                frag_bpm = 0.0
                frag_beats = []
            from services.wav2vec_alignment import align_lyrics_with_mms
            word_timings, aligned_text = align_lyrics_with_mms(
                audio_path, whisper_result.get("words", []), user_lyrics,
                audio_start=0,  # Full track, no offset
                fragment_duration=full_duration,
                bpm=full_bpm,
                beats=full_beats,
            )
            return {
                "text": aligned_text,
                "words": [w.model_dump() for w in word_timings],
                "language": whisper_result.get("language", "unknown"),
                "method": "mms_alignment",
                "whisper_words": len(whisper_result.get("words", [])),
                "aligned_words": len(word_timings),
                "bpm": full_bpm,
                "total_duration": round(full_duration, 2),
            }
        else:
            # No user lyrics — return whisper's own transcription
            # Timestamps are already 0-based (relative to extracted fragment)
            words = whisper_result.get("words", [])
            
            return {
                "text": whisper_result.get("text", ""),
                "words": words,
                "language": whisper_result.get("language", "unknown"),
                "method": "whisper_only",
            }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Word-level subtitle split ───

@app.post("/api/subtitles/word-split")
async def api_word_split_subtitles(req: WordSubtitleRequest):
    """Split lyrics into word-level subtitles with karaoke timing."""
    fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
    word_timings = [WordTiming(**w) if isinstance(w, dict) else w for w in (req.word_timings or [])]
    
    # Apply audio_start offset: word timings are in absolute audio coordinates
    # Video timeline starts at 0, so subtract audio_start
    if word_timings and req.audio_start > 0:
        adjusted_timings = []
        for wt in word_timings:
            adjusted_start = wt.start - req.audio_start
            adjusted_end = wt.end - req.audio_start
            # Only include words that fall within the video timeline (>= 0)
            if adjusted_end > 0:
                adjusted_timings.append(WordTiming(
                    word=wt.word,
                    start=round(max(0, adjusted_start), 3),
                    end=round(adjusted_end, 3),
                    probability=wt.probability,
                ))
        word_timings = adjusted_timings
    
    subtitles = split_lyrics_word_level(
        lyrics=req.lyrics,
        fragments=fragments,
        word_timings=word_timings if word_timings else None,
    )
    return {"subtitles": [s.model_dump() for s in subtitles]}


@app.post("/api/subtitles/adjust")
async def api_adjust_subtitles(req: SubtitleAdjustRequest):
    """Apply global stretch/offset to word timings and regenerate subtitles."""
    fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
    word_timings = [WordTiming(**w) if isinstance(w, dict) else w for w in (req.word_timings or [])]
    
    stretch = req.stretch
    offset = req.audio_start
    
    if word_timings and (stretch != 1.0 or offset != 0.0):
        adjusted = []
        for wt in word_timings:
            new_start = wt.start * stretch + offset
            new_end = wt.end * stretch + offset
            if new_end > 0:
                adjusted.append(WordTiming(
                    word=wt.word,
                    start=round(max(0, new_start), 3),
                    end=round(new_end, 3),
                ))
        word_timings = adjusted
    
    subtitles = split_lyrics_word_level(
        lyrics=req.lyrics,
        fragments=fragments,
        word_timings=word_timings if word_timings else None,
    )
    return {
        "subtitles": [s.model_dump() for s in subtitles],
        "words": [w.model_dump() for w in word_timings],
    }


# ─── Stem Separation (vocal isolation) ───

@app.post("/api/stem-separate")
async def api_stem_separate(
    audio_path: str = Form(...),
    method: str = Form("auto"),
):
    """Separate vocals from instrumental. Returns paths to stems."""
    try:
        from services.stem_separator import separate_vocals_with_stems
        
        stems = await separate_vocals_with_stems(audio_path, method=method)
        
        return {
            "stems": stems,
            "method": "ml" if "drums" in stems else "ffmpeg",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)