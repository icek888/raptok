"""File serving + upload router."""
import os
import shutil
from fastapi import APIRouter, UploadFile, File, HTTPException
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
    return {"path": str(audio_path), "filename": file.filename, "size": os.path.getsize(audio_path)}