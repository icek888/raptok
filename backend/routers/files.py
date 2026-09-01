"""File serving + upload router."""
import os
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from config import TEMP_DIR, OUTPUT_DIR

router = APIRouter()


@router.get("/api/download/{filename}")
async def download_file(filename: str):
    """Download a rendered clip."""
    filepath = OUTPUT_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(filepath), media_type="video/mp4", filename=filename)


@router.get("/api/video/{filename}")
async def serve_video(filename: str):
    """Serve source video from temp dir for preview."""
    if ".." in filename or "/" in filename or not filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = TEMP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(str(filepath), media_type="video/mp4", filename=filename)


@router.get("/api/thumbnail/{filename}")
async def get_thumbnail_file(filename: str):
    """Serve a thumbnail image."""
    filepath = TEMP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(filepath), media_type="image/jpeg")


@router.get("/api/audio-preview/{filename}")
async def audio_preview(filename: str):
    """Serve audio file for preview playback."""
    for f in TEMP_DIR.iterdir():
        if filename in f.name:
            return FileResponse(str(f), media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Audio file not found")


@router.post("/api/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file (mp3)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    job_id = f"audio_{os.urandom(6).hex()}"
    audio_path = TEMP_DIR / f"{job_id}_{file.filename}"
    with open(audio_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    # Return duration too
    try:
        import librosa
        duration = librosa.get_duration(path=str(audio_path))
        return {"path": str(audio_path), "filename": file.filename, "size": os.path.getsize(audio_path), "duration": round(duration, 2)}
    except Exception:
        return {"path": str(audio_path), "filename": file.filename, "size": os.path.getsize(audio_path)}


@router.post("/api/audio-from-youtube")
async def audio_from_youtube(url: str = Form(...)):
    """Download audio from YouTube URL and return path + duration."""
    import subprocess
    job_id = f"audio_{os.urandom(6).hex()}"
    audio_path = TEMP_DIR / f"{job_id}.mp3"
    try:
        result = subprocess.run([
            "yt-dlp", "-x", "--audio-format", "mp3",
            "--no-playlist", "-o", str(audio_path),
            url
        ], capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=f"yt-dlp failed: {result.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="YouTube download timed out (120s)")

    if not audio_path.exists():
        raise HTTPException(status_code=500, detail="Audio file not created")

    try:
        import librosa
        duration = librosa.get_duration(path=str(audio_path))
    except Exception:
        duration = 0

    return {"path": str(audio_path), "filename": audio_path.name, "size": os.path.getsize(audio_path), "duration": round(duration, 2)}


@router.post("/api/upload/video")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file directly (mp4/webm)."""
    import subprocess
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    job_id = f"video_{os.urandom(6).hex()}"
    suffix = os.path.splitext(file.filename)[1] or ".mp4"
    video_path = TEMP_DIR / f"{job_id}{suffix}"
    with open(video_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Probe metadata with ffprobe
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(video_path)
        ], capture_output=True, text=True, timeout=30)
        import json
        meta = json.loads(probe.stdout)
        vstream = next((s for s in meta.get("streams", []) if s.get("codec_type") == "video"), {})
        return {
            "job_id": job_id,
            "title": file.filename,
            "source": "upload",
            "duration": float(meta.get("format", {}).get("duration", 0)),
            "width": int(vstream.get("width", 0)),
            "height": int(vstream.get("height", 0)),
            "local_path": str(video_path),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to probe video: {e}")