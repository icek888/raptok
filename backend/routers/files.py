"""File serving + upload router."""
import os
import shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse
from config import TEMP_DIR, OUTPUT_DIR

router = APIRouter()


@router.get("/api/download/{filename}")
async def download_file(filename: str, request: Request):
    """Download a rendered clip (ownership-checked)."""
    name = os.path.basename(filename)
    if not name or name.startswith(".") or name != filename:
        raise HTTPException(status_code=404, detail="File not found")
    filepath = OUTPUT_DIR / name
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Ownership check: render must belong to the current user (or be admin)
    try:
        from routers.auth import SESSION_COOKIE, _verify_token
        from services import database
        token = request.cookies.get(SESSION_COOKIE)
        session = _verify_token(token) if token else None
        if session:
            user = database.get_user(session["username"])
            if user and user.get("role") == "admin":
                return FileResponse(str(filepath), media_type="video/mp4", filename=name)
            row = database.get_render_by_filename(name)
            if row and row.get("user") == session["username"]:
                return FileResponse(str(filepath), media_type="video/mp4", filename=name)
    except Exception:
        pass
    raise HTTPException(status_code=403, detail="Not authorized to download this file")


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
    """Serve a thumbnail image (strict basename + image whitelist)."""
    name = os.path.basename(filename)
    if not name or name.startswith(".") or name != filename:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    filepath = TEMP_DIR / name
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(filepath), media_type="image/jpeg")


@router.get("/api/audio-preview/{filename}")
async def audio_preview(filename: str):
    """Serve audio file for preview playback (strict basename match)."""
    name = os.path.basename(filename)
    if not name or name.startswith(".") or name != filename:
        raise HTTPException(status_code=404, detail="Audio file not found")
    if not name.lower().endswith((".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg")):
        raise HTTPException(status_code=404, detail="Audio file not found")
    filepath = TEMP_DIR / name
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media = "audio/wav" if filepath.suffix.lower() == ".wav" else "audio/mpeg"
    return FileResponse(str(filepath), media_type=media)


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
    """Download audio from YouTube URL and return path + duration + title."""
    import asyncio
    import subprocess
    job_id = f"audio_{os.urandom(6).hex()}"
    audio_path = TEMP_DIR / f"{job_id}.mp3"
    try:
        # Get video title for project naming
        title_result = await asyncio.to_thread(subprocess.run,
            ["yt-dlp", "--print", "title", "--no-playlist", url],
            capture_output=True, text=True, timeout=15
        )
        title = title_result.stdout.strip() if title_result.returncode == 0 else None

        result = await asyncio.to_thread(subprocess.run, [
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

    # Use title as filename for display, fallback to file name
    display_name = title if title else audio_path.name

    return {"path": str(audio_path), "filename": display_name, "size": os.path.getsize(audio_path), "duration": round(duration, 2)}


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
        import asyncio
        probe = await asyncio.to_thread(subprocess.run, [
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