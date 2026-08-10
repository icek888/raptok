"""RapTok API — main FastAPI app."""
import os
import shutil
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from config import TEMP_DIR, OUTPUT_DIR
from models.schemas import (
    AnalyzeRequest, VideoInfo, FragmentSelectRequest, Fragment,
    FragmentReplaceRequest, SubtitleRequest, SubtitleLine,
    RenderRequest, RenderStatus, SubtitleStyle
)
from services.downloader import download_video
from services.fragment_selector import select_fragments, replace_fragment, get_total_duration
from services.thumbnail_generator import get_thumbnail
from services.subtitle_generator import split_lyrics, generate_ass
from services.video_renderer import render_clip

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
async def health():
    return {"status": "ok", "service": "raptok", "version": "0.1.0"}


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
        
        output_path = render_clip(
            video_path=req.video_path,
            fragments=fragments,
            audio_path=req.audio_path,
            subtitles=subtitles,
            style=req.style,
        )
        
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


@app.get("/api/thumbnail/{filename}")
async def get_thumbnail_file(filename: str):
    """Serve a thumbnail image."""
    filepath = TEMP_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(str(filepath), media_type="image/jpeg")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)