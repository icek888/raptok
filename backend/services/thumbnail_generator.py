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