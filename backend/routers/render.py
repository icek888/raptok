"""Render + preview router."""
import os
import logging
import tempfile
import subprocess
from fastapi import APIRouter, HTTPException, Request
from config import TEMP_DIR
from models.schemas import (
    RenderRequest, SubtitleLine, Fragment,
    PreparePreviewRequest,
)
from services.subtitle_generator import generate_ass, rebuild_subtitles_from_words
from services.video_renderer import render_clip
from routers.helpers import parse_fragments, parse_subtitles

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/api/render")
async def api_render(request: Request, req: RenderRequest):
    """Render the final TikTok clip."""
    try:
        # ── Quota check ──
        from services import database
        from routers.auth import SESSION_COOKIE, _verify_token
        _token = request.cookies.get(SESSION_COOKIE)
        if _token:
            _session = _verify_token(_token)
            if _session:
                quota = database.check_render_quota(_session["username"])
                if not quota["allowed"]:
                    raise HTTPException(
                        status_code=429,
                        detail=f"Daily render limit reached ({quota['limit']}/day on {quota['plan']} plan). Upgrade to continue."
                    )

        fragments = parse_fragments(req.fragments)
        subtitles = parse_subtitles(req.subtitles)

        # Resolve template — video params only (blur, overlay, scale, glow, fade)
        template_dict = None
        if req.template_id:
            from models.schemas import TEMPLATES
            tmpl = next((t for t in TEMPLATES if t.id == req.template_id), None)
            if tmpl:
                template_dict = tmpl.model_dump()
                logger.info(f"Template: {tmpl.name} — font={req.style.font}, size={req.style.size}, blur={tmpl.blur_sigma}, mode={req.display_mode}")
            else:
                logger.warning(f"Template not found: {req.template_id}")

        words_count = sum(len(s.words) for s in subtitles if s.words)
        logger.info(f"Render: {len(subtitles)} subs, {words_count} words, template={req.template_id or 'none'}, word_timings={len(req.word_timings) if req.word_timings else 0}")

        # If edited word_timings provided, rebuild subtitles from them
        if req.word_timings and len(req.word_timings) > 0:
            subtitles = rebuild_subtitles_from_words(req.word_timings)
            logger.info(f"Rebuilt {len(subtitles)} subtitles from {len(req.word_timings)} word_timings")

        # Extract audio segment if audio_start is set
        audio_path = req.audio_path
        if req.audio_start > 0:
            total_dur = sum(f.duration for f in fragments)
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
            beat_effects_enabled=req.beat_effects_enabled,
            beats=req.beats or [],
            zoom_intensity=req.zoom_intensity,
            flash_intensity=req.flash_intensity,
            shake_intensity=req.shake_intensity,
            energy_curve=req.energy_curve or [],
            energy_times=req.energy_times or [],
        )

        # Cleanup temp audio
        if req.audio_start > 0:
            try:
                if os.path.exists(tmp_audio):
                    os.unlink(tmp_audio)
            except Exception:
                pass

        # ── Save render to database ──
        try:
            from services import database
            from routers.auth import SESSION_COOKIE, _verify_token
            import os as _os
            file_size = 0
            if output_path and _os.path.exists(output_path):
                file_size = _os.path.getsize(output_path)
            total_dur = sum(f.duration for f in fragments)
            token = request.cookies.get(SESSION_COOKIE)
            if token:
                session = _verify_token(token)
                if session:
                    database.save_render(
                        user=session["username"],
                        filename=os.path.basename(output_path),
                        output_path=output_path,
                        duration=total_dur,
                        file_size=file_size,
                    )
                    # Record quota usage
                    database.record_render_quota(session["username"])
        except Exception as e:
            logger.warning(f"Failed to save render to DB: {e}")

        return {
            "status": "completed",
            "output_path": output_path,
            "filename": os.path.basename(output_path),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/prepare-preview")
async def prepare_preview(req: PreparePreviewRequest):
    """
    Prepare a preview clip:
    1. Concat selected VIDEO fragments (from Step 1) into one clip.
    2. Extract AUDIO segment (from Step 2): continuous slice from audio_start,
       length = total duration of all video fragments.
    3. Filter word_timings & subtitles to those that fall within video fragment boundaries.
       Both audio and concat video are 0-based with the same total duration.
    """
    try:
        fragments = parse_fragments(req.fragments)
        if not fragments:
            raise HTTPException(status_code=400, detail="No fragments provided")

        job_id = f"preview_{os.urandom(6).hex()}"
        total_video_dur = sum(f.duration for f in fragments)

        # ── 1. Concat VIDEO fragments ──
        concat_file = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
        for frag in fragments:
            concat_file.write(f"file '{req.video_path}'\n")
            concat_file.write(f"inpoint {frag.start}\n")
            concat_file.write(f"outpoint {frag.start + frag.duration}\n")
        concat_file.close()

        preview_video = TEMP_DIR / f"{job_id}.mp4"
        result = subprocess.run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_file.name, "-c", "copy",
            str(preview_video)
        ], capture_output=True, timeout=120)

        if result.returncode != 0:
            result = subprocess.run([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file.name,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-an",
                str(preview_video)
            ], capture_output=True, timeout=180)
        os.unlink(concat_file.name)

        # ── 2. Extract AUDIO segment (continuous slice from audio_start) ──
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

        # ── 3. Filter words/subtitles to those within video fragment boundaries ──
        # Both audio and concat video are 0-based, same total duration.
        # Words in gaps (no video) are simply dropped.
        frag_boundaries = []
        cum = 0.0
        for frag in fragments:
            frag_boundaries.append((cum, cum + frag.duration))
            cum += frag.duration

        def in_any_fragment(t, tolerance=0.3):
            return any(s - tolerance <= t < e for s, e in frag_boundaries)

        shifted_timings = [
            {**w, "start": round(max(0, w["start"]), 3), "end": round(max(0, w["end"]), 3)}
            for w in (req.word_timings or [])
            if in_any_fragment(w.get("start", 0))
        ]

        shifted_subs = []
        for s in (req.subtitles or []):
            if not in_any_fragment(s.get("start", 0)):
                continue
            shifted_sub = {**s, "start": round(max(0, s["start"]), 3), "end": round(max(0, s["end"]), 3)}
            if shifted_sub.get("words"):
                shifted_sub["words"] = [
                    {**w, "start": round(max(0, w["start"]), 3), "end": round(max(0, w["end"]), 3)}
                    for w in shifted_sub["words"]
                ]
            shifted_subs.append(shifted_sub)

        logger.info(f"[preview] fragments={len(fragments)} dur={total_video_dur:.1f} words IN={len(req.word_timings or [])} OUT={len(shifted_timings)} subs IN={len(req.subtitles or [])} OUT={len(shifted_subs)}")

        return {
            "video_url": f"/api/video/{preview_video.name}",
            "audio_url": f"/api/audio-preview/{preview_audio.name}" if preview_audio else None,
            "duration": round(total_video_dur, 2),
            "word_timings": shifted_timings,
            "subtitles": shifted_subs,
            "fragments": [
                {"id": i,
                 "start": round(sum(f.duration for f in fragments[:i]), 2),
                 "end": round(sum(f.duration for f in fragments[:i+1]), 2),
                 "duration": frag.duration}
                for i, frag in enumerate(fragments)
            ],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))