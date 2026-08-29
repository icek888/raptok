"""Video analysis + fragment selection + thumbnails router."""
from fastapi import APIRouter, Form, HTTPException
from models.schemas import AnalyzeRequest, VideoInfo, FragmentSelectRequest, FragmentReplaceRequest
from services.downloader import download_video
from services.fragment_selector import select_fragments, replace_fragment, get_total_duration
from services.thumbnail_generator import get_thumbnail

router = APIRouter()
_jobs: dict = {}


@router.post("/api/analyze", response_model=VideoInfo)
async def analyze_video(req: AnalyzeRequest):
    """Download video and return metadata."""
    try:
        info = download_video(req.url)
        _jobs[info["job_id"]] = {"video": info, "status": "analyzed"}
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/fragments/select")
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


@router.post("/api/fragments/replace")
async def api_replace_fragment(req: FragmentReplaceRequest):
    """Replace a specific fragment with new start time."""
    from routers.helpers import parse_fragments
    fragments = parse_fragments(req.fragments)
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


@router.post("/api/thumbnails")
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