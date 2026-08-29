"""RapTok API — main FastAPI app."""
import os
import shutil
import logging
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from config import TEMP_DIR, OUTPUT_DIR
from models.schemas import (
    AnalyzeRequest, VideoInfo, FragmentSelectRequest, Fragment,
    FragmentReplaceRequest, SubtitleRequest, SubtitleLine,
    RenderRequest, RenderStatus, SubtitleStyle,
    BPMRequest, BPMResult, BeatSyncRequest, BeatSyncResult,
    TranscribeRequest, TranscribeResult,
    WordTiming, WordSubtitleRequest, SubtitleAdjustRequest,
    PreparePreviewRequest,
)
from services.downloader import download_video
from services.fragment_selector import select_fragments, replace_fragment, get_total_duration
from services.thumbnail_generator import get_thumbnail
from services.subtitle_generator import split_lyrics, split_lyrics_word_level, generate_ass
from services.video_renderer import render_clip
from services.bpm_detector import detect_bpm, get_beat_aligned_starts
from services.speech_recognizer import transcribe_to_lyrics
from services.audio_analyzer import analyze_track

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
                "margin_v": t.margin_v,
                "active_scale": t.active_scale,
                "glow_border": t.glow_border,
                "fade_in": t.fade_in,
                "outline_color": t.outline_color,
                "outline_width": t.outline_width,
                "bold": t.bold,
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
        
        # Resolve template if provided — use template for VIDEO rendering params only
        # (blur, dark_overlay, scale_factor, glow, fade). Subtitle STYLE (font, color,
        # size, position) comes entirely from req.style — the frontend already applies
        # template defaults to style state, and user overrides on top. So backend just
        # uses the style as-is.
        template_dict = None
        if req.template_id:
            from models.schemas import TEMPLATES
            tmpl = next((t for t in TEMPLATES if t.id == req.template_id), None)
            if tmpl:
                template_dict = tmpl.model_dump()
                # Template controls ONLY video params (blur, overlay, scale, glow, fade_in, active_scale).
                # Subtitle style + display_mode + karaoke come from frontend as-is.
                logger.info(f"Template video params: {tmpl.name} — font={req.style.font}, size={req.style.size}, color={req.style.active_color}, blur={tmpl.blur_sigma}, mode={req.display_mode}")
            else:
                logger.warning(f"Template not found: {req.template_id}")
        
        # DEBUG: Log what we receive
        words_count = sum(len(s.words) for s in subtitles if s.words)
        logger.info(f"Render: {len(subtitles)} subs, {words_count} words, template={req.template_id or 'none'}, word_timings={len(req.word_timings) if req.word_timings else 0}")
        for i, s in enumerate(subtitles[:3]):
            logger.info(f"  sub[{i}]: text='{s.text[:30]}', words={len(s.words) if s.words else 0}")
        
        # ── If edited word_timings provided, rebuild subtitles from them ──
        if req.word_timings and len(req.word_timings) > 0:
            from services.subtitle_generator import rebuild_subtitles_from_words
            subtitles = rebuild_subtitles_from_words(req.word_timings)
            logger.info(f"Rebuilt {len(subtitles)} subtitles from {len(req.word_timings)} edited word_timings")
        
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


@app.get("/api/video/{filename}")
async def serve_video(filename: str):
    """Serve source video from temp dir for preview."""
    # Security: only allow .mp4 files, no path traversal
    if ".." in filename or "/" in filename or not filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = TEMP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Video not found")
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


# ─── Preview clip: concat video fragments + extract audio segment ───

@app.post("/api/prepare-preview")
async def prepare_preview(req: PreparePreviewRequest):
    """
    Prepare a preview clip:
    1. Concat selected VIDEO fragments (from Step 1) into one clip.
    2. Extract AUDIO segment (from Step 2): continuous slice from audio_start,
       length = total duration of all video fragments.
    3. Shift word_timings & subtitles to 0-based relative to concat video clip.
       Words are 0-based relative to audio_start. We map each word to the
       corresponding video fragment based on cumulative time.
    """
    try:
        import subprocess
        import tempfile

        fragments = [Fragment(**f) if isinstance(f, dict) else f for f in req.fragments]
        if not fragments:
            raise HTTPException(status_code=400, detail="No fragments provided")

        job_id = f"preview_{os.urandom(6).hex()}"
        total_video_dur = sum(f.duration for f in fragments)

        # ── 1. Concat VIDEO fragments (from Step 1) ──
        concat_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
        for frag in fragments:
            concat_file.write(f"file '{req.video_path}'\n")
            concat_file.write(f"inpoint {frag.start}\n")
            concat_file.write(f"outpoint {frag.start + frag.duration}\n")
        concat_file.close()

        preview_video = TEMP_DIR / f"{job_id}.mp4"
        result = subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_file.name,
            "-c", "copy",
            str(preview_video)
        ], capture_output=True, timeout=120)

        if result.returncode != 0:
            # Fallback: re-encode
            result = subprocess.run([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file.name,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                "-an",
                str(preview_video)
            ], capture_output=True, timeout=180)
        os.unlink(concat_file.name)

        # ── 2. Extract AUDIO segment (from Step 2) ──
        # Audio is a continuous slice from audio_start, length = total video duration.
        # Words are 0-based relative to audio_start, so they map directly to audio.
        preview_audio = None
        if req.audio_path:
            audio_start = req.audio_start or 0.0
            preview_audio = TEMP_DIR / f"{job_id}_audio.mp3"
            result = subprocess.run([
                "ffmpeg", "-y",
                "-ss", str(audio_start), "-t", str(total_video_dur),
                "-i", req.audio_path,
                "-ac", "2", "-ab", "128k",
                str(preview_audio)
            ], capture_output=True, timeout=120)
            if result.returncode != 0:
                preview_audio = None

        # ── 3. Map word_timings to concat video timeline ──
        # Words are 0-based relative to audio_start (from SubtitleEditor).
        # Video concat clip is also 0-based (first fragment starts at 0).
        # BUT: video fragments are scattered (e.g. 18-22s, 40-44s, 61-66s...).
        # Audio is continuous (0s to total_video_dur).
        # So word at time T (0-based audio) maps to time T in the concat video.
        # Words that fall in "gaps" between video fragments are simply dropped
        # (no video to show them on).
        #
        # To map: build a cumulative timeline for video fragments:
        #   frag 0: [0, dur0)
        #   frag 1: [dur0, dur0+dur1)
        #   ...
        # Word at time T belongs to fragment i if:
        #   cum_start[i] <= T < cum_end[i]
        # Then shifted to: T - cum_start[i] + cum_start[i] = T (already 0-based!)
        #
        # Actually: since both audio and concat video start at 0 and have the
        # same total duration, word at time T in audio = time T in concat video.
        # We just need to filter words that fall in video gaps.

        # Build cumulative fragment boundaries (0-based)
        frag_boundaries = []
        cum = 0.0
        for frag in fragments:
            frag_boundaries.append((cum, cum + frag.duration))
            cum += frag.duration

        def in_any_fragment(t):
            """Check if time t falls within any video fragment's range."""
            for (s, e) in frag_boundaries:
                if s - 0.3 <= t < e:  # 0.3s tolerance
                    return True
            return False

        # Words: keep only those that fall within video fragment boundaries
        shifted_timings = []
        for w in (req.word_timings or []):
            w_start = w.get("start", 0)
            if in_any_fragment(w_start):
                # Word time is already 0-based relative to audio_start,
                # and concat video is also 0-based. Direct mapping!
                shifted_timings.append({
                    **w,
                    "start": round(max(0, w["start"]), 3),
                    "end": round(max(0, w["end"]), 3),
                })

        # Subtitles: same logic
        shifted_subs = []
        for s in (req.subtitles or []):
            s_start = s.get("start", 0)
            if in_any_fragment(s_start):
                shifted_sub = {**s}
                shifted_sub["start"] = round(max(0, s["start"]), 3)
                shifted_sub["end"] = round(max(0, s["end"]), 3)
                if shifted_sub.get("words"):
                    shifted_sub["words"] = [
                        {**w,
                         "start": round(max(0, w["start"]), 3),
                         "end": round(max(0, w["end"]), 3)}
                        for w in shifted_sub["words"]
                    ]
                shifted_subs.append(shifted_sub)

        total_duration = total_video_dur

        print(f"[prepare-preview] fragments={len(fragments)} total_dur={total_video_dur:.1f}")
        print(f"[prepare-preview] word_timings IN={len(req.word_timings or [])} OUT={len(shifted_timings)}")
        print(f"[prepare-preview] subtitles IN={len(req.subtitles or [])} OUT={len(shifted_subs)}")
        print(f"[prepare-preview] fragment boundaries: {[(round(s,1), round(e,1)) for s,e in frag_boundaries]}")

        return {
            "video_url": f"/api/video/{preview_video.name}",
            "audio_url": f"/api/audio-preview/{preview_audio.name}" if preview_audio else None,
            "duration": round(total_duration, 2),
            "word_timings": shifted_timings,
            "subtitles": shifted_subs,
            "fragments": [
                {"id": i, "start": round(sum(f.duration for f in fragments[:i]), 2),
                 "end": round(sum(f.duration for f in fragments[:i+1]), 2),
                 "duration": frag.duration}
                for i, frag in enumerate(fragments)
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


# ─── Deep Track Analysis (mood, energy, genre, hook) ───

@app.post("/api/track-analysis")
async def api_track_analysis(req: BPMRequest):
    """Deep audio analysis: mood, energy profile, genre hint, hook detection."""
    try:
        result = analyze_track(req.audio_path)
        return result
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

@app.post("/api/transcribe-full-stream")
async def api_transcribe_full_stream(
    audio_path: str = Form(...),
    language: str = Form("en"),
    lyrics: str = Form(""),
    model_size: str = Form(""),
):
    """Transcribe with SSE progress updates — same as transcribe-full but streams status."""
    import json
    import asyncio
    import time

    async def generate():
        try:
            from services.speech_recognizer import transcribe_audio
            from services.forced_alignment import align_lyrics_to_timings
            from services.bpm_detector import detect_bpm
            from services.stem_separator import separate_vocals

            t0 = time.time()
            def elapsed():
                return round(time.time() - t0, 1)

            # Step 1: Stem separation (~65s)
            yield f"data: {json.dumps({'step': 'separation', 'label': 'Separating vocals from music...', 'progress': 5, 'elapsed': elapsed()})}\n\n"

            try:
                vocal_path = await separate_vocals(audio_path, method="auto")
                whisper_input = vocal_path
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Vocals isolated ✓', 'progress': 25, 'elapsed': elapsed()})}\n\n"
            except Exception as e:
                logger.warning(f"Stem separation failed ({e}), using original audio")
                whisper_input = audio_path
                yield f"data: {json.dumps({'step': 'separation', 'label': 'Using original audio (separation skipped)', 'progress': 25, 'elapsed': elapsed()})}\n\n"

            # Step 2: WhisperX transcription (~48s)
            model_label = model_size or "small"
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'WhisperX transcribing ({model_label})...', 'progress': 30, 'elapsed': elapsed()})}\n\n"

            # Run whisper in a thread to not block event loop
            loop = asyncio.get_event_loop()
            whisper_result = await loop.run_in_executor(
                None,
                lambda: transcribe_audio(whisper_input, language=language, word_timestamps=True, lyrics=lyrics, model_size=model_size)
            )

            whisper_words = whisper_result.get("words", [])
            yield f"data: {json.dumps({'step': 'transcription', 'label': f'Transcribed {len(whisper_words)} words ✓', 'progress': 70, 'elapsed': elapsed()})}\n\n"

            user_lyrics = lyrics.strip() if lyrics else ""

            # Step 3: Alignment / DTW
            if user_lyrics:
                yield f"data: {json.dumps({'step': 'alignment', 'label': 'Aligning lyrics to audio...', 'progress': 75, 'elapsed': elapsed()})}\n\n"

                try:
                    bpm_result = detect_bpm(audio_path)
                    full_bpm = bpm_result.get("bpm", 0.0)
                    full_beats = bpm_result.get("beats", [])
                except Exception:
                    full_bpm = 0.0
                    full_beats = []

                import librosa
                full_duration = librosa.get_duration(path=audio_path)

                word_timings = align_lyrics_to_timings(user_lyrics, whisper_words)

                yield f"data: {json.dumps({'step': 'alignment', 'label': f'Aligned {len(word_timings)} words ✓', 'progress': 95, 'elapsed': elapsed()})}\n\n"

                result = {
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
                yield f"data: {json.dumps({'step': 'alignment', 'label': 'Finalizing timestamps...', 'progress': 95, 'elapsed': elapsed()})}\n\n"
                result = {
                    "text": whisper_result.get("text", ""),
                    "words": whisper_words,
                    "language": whisper_result.get("language", "unknown"),
                    "method": "whisperx_only",
                }

            yield f"data: {json.dumps({'step': 'done', 'label': 'Complete ✓', 'progress': 100, 'elapsed': elapsed(), 'result': result})}\n\n"

        except Exception as e:
            logger.error(f"Transcribe stream error: {e}")
            yield f"data: {json.dumps({'step': 'error', 'label': str(e), 'progress': 0})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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