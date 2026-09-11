"""Thumbnail generator — extract single frames from video."""
import subprocess
from pathlib import Path
from config import TEMP_DIR


def get_thumbnail(video_path: str, timestamp: float, job_id: str = "thumb") -> str:
    """
    Extract a single frame from video at given timestamp.
    Returns path to the JPEG thumbnail.
    """
    output_path = TEMP_DIR / f"{job_id}_{int(timestamp * 1000)}.jpg"
    
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-frames:v", "1",
        "-q:v", "2",
        "-vf", "scale=320:-1",
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"Thumbnail extraction failed: {result.stderr[:200]}")

    return str(output_path)


def get_916_preview(
    video_path: str,
    timestamp: float,
    crop_mode: str = "crop_fill",
    job_id: str = "preview916",
    width: int = 270,
    height: int = 480,
) -> str:
    """
    Extract a single frame from video, cropped to 9:16 aspect ratio.
    Matches the render output so user sees exactly what the final clip will look like.

    crop_mode:
      - "crop_fill": scale to fill 9:16, crop overflow (zoom)
      - "fit_blur": scale to fit, pad with black (letterbox)

    Returns path to the PNG file.
    """
    output_path = TEMP_DIR / f"{job_id}_{int(timestamp * 1000)}.png"

    if crop_mode == "crop_fill":
        vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    else:
        # fit_blur — scale to fit + pad
        vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-frames:v", "1",
        "-vf", vf,
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"9:16 preview extraction failed: {result.stderr[:200]}")

    return str(output_path)