"""Video downloader service — YouTube, rezka.ag, direct URLs."""
import re
import os
import subprocess
import json
import uuid
from pathlib import Path

from config import TEMP_DIR
from models.schemas import VideoSource


def _detect_source(url: str) -> VideoSource:
    if "youtube.com" in url or "youtu.be" in url:
        return VideoSource.youtube
    if "rezka.ag" in url or "hdrezka" in url:
        return VideoSource.rezka
    return VideoSource.direct


def _get_video_info(path: str) -> dict:
    """Get video metadata via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[:200]}")
    
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    
    return {
        "duration": float(data.get("format", {}).get("duration", 0)),
        "width": int(video_stream.get("width", 0)),
        "height": int(video_stream.get("height", 0)),
        "title": data.get("format", {}).get("tags", {}).get("title", os.path.basename(path)),
    }


def download_video(url: str) -> dict:
    """
    Download video from URL. Returns dict with:
    - local_path, duration, width, height, title, source, job_id
    """
    source = _detect_source(url)
    job_id = uuid.uuid4().hex[:12]
    
    if source == VideoSource.youtube:
        return _download_youtube(url, job_id)
    elif source == VideoSource.rezka:
        return _download_rezka(url, job_id)
    else:
        return _download_direct(url, job_id)


def _download_youtube(url: str, job_id: str) -> dict:
    """Download via yt-dlp."""
    output_path = TEMP_DIR / f"{job_id}.mp4"
    
    cmd = [
        "yt-dlp",
        "-f", "best[height<=720][ext=mp4]/best[ext=mp4]/best",
        "-o", str(output_path),
        "--no-playlist",
        url
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr[:300]}")
    
    info = _get_video_info(output_path)
    return {
        "url": url,
        "source": VideoSource.youtube,
        "title": info["title"],
        "duration": info["duration"],
        "width": info["width"],
        "height": info["height"],
        "local_path": str(output_path),
        "job_id": job_id,
    }


def _download_rezka(url: str, job_id: str) -> dict:
    """Download from rezka.ag — parse page for m3u8, then ffmpeg."""
    import urllib.request
    
    # Fetch the page
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })
    
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    
    # Find video ID and translate to get m3u8
    # rezka uses POST to /ajax/ with id and translator_id
    video_id_match = re.search(r'video_id\s*[:=]\s*(\d+)', html)
    translator_match = re.search(r'translator_id\s*[:=]\s*(\d+)', html)
    
    if not video_id_match:
        raise RuntimeError("Could not parse rezka page — video_id not found")
    
    video_id = video_id_match.group(1)
    translator_id = translator_match.group(1) if translator_match else ""
    
    # Get m3u8 URL via API
    import urllib.parse
    api_url = f"https://rezka.ag/ajax/video"
    data = urllib.parse.urlencode({
        "id": video_id,
        "translator_id": translator_id,
        "action": "get_video",
    }).encode()
    
    req2 = urllib.request.Request(api_url, data=data, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": url,
    })
    
    with urllib.request.urlopen(req2, timeout=15) as resp:
        api_data = json.loads(resp.read().decode("utf-8"))
    
    # Extract m3u8 URL
    m3u8_url = ""
    qualities = api_data.get("qualities", [])
    if qualities:
        # Pick highest quality
        m3u8_url = qualities[-1].get("url", "")
    
    if not m3u8_url:
        # Try from clearAutoplay
        m3u8_url = api_data.get("url", "")
    
    if not m3u8_url:
        raise RuntimeError("Could not get m3u8 URL from rezka API")
    
    return _download_hls(m3u8_url, job_id, url)


def _download_hls(m3u8_url: str, job_id: str, referer: str) -> dict:
    """Download HLS stream via ffmpeg."""
    output_path = TEMP_DIR / f"{job_id}.mp4"
    
    cmd = [
        "ffmpeg", "-y",
        "-headers", f"Referer: {referer}\r\nUser-Agent: Mozilla/5.0",
        "-i", m3u8_url,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg HLS download failed: {result.stderr[:300]}")
    
    info = _get_video_info(output_path)
    return {
        "url": "",
        "source": VideoSource.rezka,
        "title": info["title"],
        "duration": info["duration"],
        "width": info["width"],
        "height": info["height"],
        "local_path": str(output_path),
        "job_id": job_id,
    }


def _download_direct(url: str, job_id: str) -> dict:
    """Download direct URL (mp4/m3u8) via ffmpeg."""
    output_path = TEMP_DIR / f"{job_id}.mp4"
    
    if ".m3u8" in url:
        cmd = [
            "ffmpeg", "-y",
            "-i", url,
            "-c", "copy",
            "-bsf:a", "aac_adtstoasc",
            str(output_path)
        ]
    else:
        cmd = [
            "ffmpeg", "-y",
            "-i", url,
            "-c", "copy",
            str(output_path)
        ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg download failed: {result.stderr[:300]}")
    
    info = _get_video_info(output_path)
    return {
        "url": url,
        "source": VideoSource.direct,
        "title": info["title"],
        "duration": info["duration"],
        "width": info["width"],
        "height": info["height"],
        "local_path": str(output_path),
        "job_id": job_id,
    }