"""Video renderer — concat fragments, scale to TikTok, burn subtitles, replace audio."""
import subprocess
import uuid
import os
import shutil
from pathlib import Path
from models.schemas import Fragment, SubtitleLine, SubtitleStyle
from services.subtitle_generator import generate_ass
from config import (
    TEMP_DIR, OUTPUT_DIR,
    OUTPUT_WIDTH, OUTPUT_HEIGHT, OUTPUT_FPS,
    FFMPEG_PRESET, FFMPEG_CRF,
)


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
) -> str:
    """
    Render a TikTok-format clip (1080x1920) from fragments with subtitles and custom audio.
    
    Multi-step pipeline:
    1. Extract each fragment from source video -> individual clips
    2. Concatenate all clips into one horizontal video
    3. Scale to 1080x1920 TikTok format (blur background + overlay)
    4. Burn subtitles (ASS format)
    5. Replace audio with user's track
    
    Returns path to the output MP4.
    """
    if job_id is None:
        job_id = uuid.uuid4().hex[:12]
    
    work_dir = TEMP_DIR / f"render_{job_id}"
    work_dir.mkdir(exist_ok=True)
    
    # Step 1: Generate ASS subtitle file
    ass_path = generate_ass(subtitles, style, job_id, karaoke=karaoke, display_mode=display_mode)
    
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
    
    # TikTok format: 1080x1920 (9:16)
    # Scale video to fit width, center vertically, blur bg fills rest
    scale_filter = (
        f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black[padded];"
        f"[0:v]scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},gblur=sigma=20[bg];"
        f"[bg][padded]overlay=0:0[withbg];"
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
        raise RuntimeError(f"ffmpeg render failed: {result.stderr[:500]}")
    
    return str(output_path)


def _get_alignment(style: SubtitleStyle) -> int:
    """Get ASS alignment from style position."""
    return {"bottom": 2, "center": 8, "top": 10}.get(style.position, 2)


def get_render_duration(fragments: list[Fragment]) -> float:
    """Get total duration of the final clip."""
    return sum(f.duration for f in fragments)