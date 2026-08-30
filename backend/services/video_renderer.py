"""Video renderer — concat fragments, scale to TikTok, burn subtitles, replace audio."""
import subprocess
import uuid
import os
import shutil
import logging
from pathlib import Path
from models.schemas import Fragment, SubtitleLine, SubtitleStyle
from services.subtitle_generator import generate_ass
from config import (
    TEMP_DIR, OUTPUT_DIR,
    OUTPUT_WIDTH, OUTPUT_HEIGHT, OUTPUT_FPS,
    FFMPEG_PRESET, FFMPEG_CRF,
)

logger = logging.getLogger(__name__)


def render_clip(
    video_path: str,
    fragments: list[Fragment],
    audio_path: str,
    subtitles: list[SubtitleLine],
    style: SubtitleStyle = SubtitleStyle(),
    job_id: str | None = None,
    progress_callback=None,
    karaoke: bool = False,
    display_mode: str = "line_highlight",
    template: dict | None = None,
    beat_effects_enabled: bool = False,
    beats: list[float] | None = None,
    zoom_intensity: float = 0.0,
    flash_intensity: float = 0.0,
    shake_intensity: float = 0.0,
    energy_curve: list[float] | None = None,
    energy_times: list[float] | None = None,
) -> str:
    """
    Render a TikTok-format clip (1080x1920) from fragments with subtitles and custom audio.
    
    If template is provided, applies template-specific:
    - blur_sigma: background blur strength
    - dark_overlay: 0.0-1.0 darkening of background
    - scale_factor: video scale (1.0 = full, 0.85 = smaller)
    - All subtitle style + effects
    
    Returns path to the output MP4.
    """
    if job_id is None:
        job_id = uuid.uuid4().hex[:12]
    
    work_dir = TEMP_DIR / f"render_{job_id}"
    work_dir.mkdir(exist_ok=True)
    
    # Step 1: Generate ASS subtitle file
    ass_path = generate_ass(
        subtitles, style, job_id,
        karaoke=karaoke, display_mode=display_mode,
        template=template,
    )
    
    # Step 2: Extract each fragment
    frag_paths = []
    for i, frag in enumerate(fragments):
        frag_path = work_dir / f"frag_{i:02d}.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(frag.start),
            "-t", str(frag.duration),
            "-i", str(video_path),
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            str(frag_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            # Fallback: re-encode if copy fails (different codecs)
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(frag.start),
                "-t", str(frag.duration),
                "-i", str(video_path),
                "-c:v", "libx264", "-preset", "fast",
                "-c:a", "aac",
                str(frag_path)
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                raise RuntimeError(f"Fragment {i} extraction failed: {result.stderr[:300]}")
        frag_paths.append(str(frag_path))
    
    # Step 3: Concatenate fragments
    concat_path = work_dir / "concat.mp4"
    concat_list = work_dir / "concat_list.txt"
    concat_list.write_text("\n".join(f"file '{p}'" for p in frag_paths))
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        str(concat_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        # Fallback: re-encode concat
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_list),
            "-c:v", "libx264", "-preset", "fast",
            "-c:a", "aac",
            str(concat_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"Concat failed: {result.stderr[:300]}")
    
    # Step 4: Scale to TikTok format + blur background + burn subtitles
    output_path = OUTPUT_DIR / f"raptok_{job_id}.mp4"
    
    # Template overrides for video rendering
    video_mode = "fit_blur"
    blur_sigma = 20
    dark_overlay = 0.0
    scale_factor = 1.0
    if template:
        video_mode = template.get("video_mode", "fit_blur")
        blur_sigma = template.get("blur_sigma", 20)
        dark_overlay = template.get("dark_overlay", 0.0)
        scale_factor = template.get("scale_factor", 1.0)
    
    # ── Beat-synced effects (optional, modular) ──
    beat_effect_filter = ""
    if beat_effects_enabled and beats:
        try:
            from services.beat_effects import build_beat_filter_safe
            # Get concat duration for beat effect timing
            concat_dur = sum(f.duration for f in fragments)
            beat_effect_filter = build_beat_filter_safe(
                beats, concat_dur,
                video_w=OUTPUT_WIDTH, video_h=OUTPUT_HEIGHT,
                energy_curve=energy_curve or [], energy_times=energy_times or [],
                zoom_intensity=zoom_intensity,
                flash_intensity=flash_intensity,
                shake_intensity=shake_intensity,
            )
            if beat_effect_filter:
                logger.info(f"Beat effects applied: {len(beats)} beats, zoom={zoom_intensity}, flash={flash_intensity}, shake={shake_intensity}")
        except Exception as e:
            logger.warning(f"Beat effects skipped: {e}")
            beat_effect_filter = ""
    
    # Build scale filter based on video_mode:
    # 1. fit_blur — scale to fit width, center, blur bg fills rest (current default)
    # 2. crop_fill — zoom to fill 9:16, crop overflow, no black bars, no blur
    # 3. fit_blur_dark — same as fit_blur but with dark blurred bg behind
    #
    # Beat effects (zoompan/crop/scale) are inserted BEFORE the video mode
    # filter so they operate on the raw concat video, then blur/overlay/subtitles
    # are applied on top of the effect-processed video.
    
    # For beat effects, we need to split the input and apply effects to the
    # foreground video, then feed it into the video_mode filter chain.
    if beat_effect_filter:
        # Beat effects active: apply to input video first, then use as [0:v]
        # We prepend the beat filter as a separate stream and reference it.
        if video_mode == "crop_fill":
            # crop_fill: beat effects + full-screen + subtitles
            scale_filter = (
                f"[0:v]{beat_effect_filter}[vfx];"
                f"[vfx]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},"
                f"subtitles={ass_path}[final]"
            )
        elif video_mode == "fit_blur_dark":
            scaled_w = int(OUTPUT_WIDTH * scale_factor)
            scaled_h = int(OUTPUT_HEIGHT * scale_factor)
            scale_filter = (
                # Apply beat effects to input, then split for bg+fg
                f"[0:v]{beat_effect_filter}[vfx];"
                # BG: vfx zoomed + blurred + darkened
                f"[vfx]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},gblur=sigma={blur_sigma},"
                f"eq=brightness=-{dark_overlay * 0.5}:contrast=0.8[bg];"
                # FG: vfx scaled down (clear)
                f"[vfx]scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2[withbg];"
                f"[withbg]subtitles={ass_path}[final]"
            )
        else:
            # fit_blur (default): beat effects + blurred bg
            scaled_w = int(OUTPUT_WIDTH * scale_factor)
            scaled_h = int(OUTPUT_HEIGHT * scale_factor)
            scale_filter = (
                # Apply beat effects to input video
                f"[0:v]{beat_effect_filter}[vfx];"
                # BG: vfx zoomed + blurred
                f"[vfx]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},gblur=sigma={blur_sigma}[bg];"
                # FG: vfx scaled down (clear)
                f"[vfx]scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2[withbg];"
                f"[withbg]subtitles={ass_path}[final]"
            )
    elif video_mode == "crop_fill":
        # Full-screen zoomed video — no blur, no bars
        scale_filter = (
            f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},"
            f"subtitles={ass_path}[final]"
        )
    elif video_mode == "fit_blur_dark":
        # Clear video scaled down + dark blurred video bg fills entire frame
        scaled_w = int(OUTPUT_WIDTH * scale_factor)
        scaled_h = int(OUTPUT_HEIGHT * scale_factor)
        scale_filter = (
            # BG: video zoomed to fill 9:16 + blur + dark
            f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},gblur=sigma={blur_sigma},"
            f"eq=brightness=-{dark_overlay * 0.5}:contrast=0.8[bg];"
            # FG: clear video scaled to fit within scaled_w x scaled_h box
            f"[0:v]scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=decrease[fg];"
            # Overlay: dynamic center — ffmpeg calculates (W-w)/2 : (H-h)/2
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[withbg];"
            # Burn subtitles on top
            f"[withbg]subtitles={ass_path}[final]"
        )
    else:
        # fit_blur (default) — clear video scaled + blurred bg
        scaled_w = int(OUTPUT_WIDTH * scale_factor)
        scaled_h = int(OUTPUT_HEIGHT * scale_factor)
        scale_filter = (
            # BG: blurred video fills entire 9:16
            f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},gblur=sigma={blur_sigma}[bg];"
            # FG: clear video scaled down
            f"[0:v]scale={scaled_w}:{scaled_h}:force_original_aspect_ratio=decrease[fg];"
            # Overlay: dynamic center
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2[withbg];"
            # Burn subtitles
            f"[withbg]subtitles={ass_path}[final]"
        )
    
    cmd = [
        "ffmpeg", "-y",
        "-i", str(concat_path),
        "-i", str(audio_path),
        "-filter_complex", scale_filter,
        "-map", "[final]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", FFMPEG_PRESET,
        "-crf", str(FFMPEG_CRF),
        "-r", str(OUTPUT_FPS),
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    
    # Clean up work dir
    shutil.rmtree(work_dir, ignore_errors=True)
    
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg render failed: {result.stderr[-2000:]}")
    
    return str(output_path)