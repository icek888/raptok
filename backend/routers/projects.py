"""
Projects router — CRUD for projects, renders, presets, settings, stats.
All endpoints require auth (middleware checks cookie).
Username is extracted from session.
"""
import os
import logging
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from services import database
from routers.auth import SESSION_COOKIE, _verify_token

logger = logging.getLogger(__name__)
router = APIRouter()

# Initialize DB on import
database.init_db()


def _get_user(request: Request) -> str:
    """Extract username from session cookie."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Not authenticated")
    session = _verify_token(token)
    if not session:
        raise HTTPException(401, "Session expired")
    return session["username"]


# ── Projects ──

class ProjectData(BaseModel):
    name: str | None = None
    video_url: str | None = None
    video_path: str | None = None
    audio_path: str | None = None
    audio_name: str | None = None
    lyrics: str | None = None
    fragments: list | None = None
    subtitles: list | None = None
    word_timings: list | None = None
    style: dict | None = None
    template_id: str | None = None
    display_mode: str | None = None
    karaoke: bool | None = None
    audio_start: float | None = None
    beat_effects: dict | None = None
    status: str | None = None


@router.get("/api/projects")
async def list_projects(request: Request):
    user = _get_user(request)
    return {"projects": database.list_projects(user)}


@router.post("/api/projects")
async def create_project(request: Request):
    user = _get_user(request)
    return database.create_project(user)


@router.get("/api/projects/{project_id}")
async def get_project(request: Request, project_id: str):
    user = _get_user(request)
    project = database.get_project(user, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


@router.put("/api/projects/{project_id}")
async def save_project(request: Request, project_id: str, data: ProjectData):
    user = _get_user(request)
    result = database.save_project(user, project_id, data.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(404, "Project not found")
    return result


class StateData(BaseModel):
    state: dict


@router.put("/api/projects/{project_id}/state")
async def save_project_state(request: Request, project_id: str, data: StateData):
    """Auto-save full state snapshot."""
    user = _get_user(request)
    if not database.save_state(user, project_id, data.state):
        raise HTTPException(404, "Project not found")
    return {"status": "saved"}


@router.get("/api/projects/{project_id}/state")
async def get_project_state(request: Request, project_id: str):
    """Load full state snapshot for restoring a project."""
    user = _get_user(request)
    state = database.get_state(user, project_id)
    if not state:
        raise HTTPException(404, "No state saved for this project")
    return {"state": state}


@router.delete("/api/projects/{project_id}")
async def delete_project(request: Request, project_id: str):
    user = _get_user(request)
    if not database.delete_project(user, project_id):
        raise HTTPException(404, "Project not found")
    return {"status": "deleted"}


# ── Renders ──

@router.get("/api/renders")
async def list_renders(request: Request):
    user = _get_user(request)
    return {"renders": database.list_renders(user)}


@router.delete("/api/renders/{render_id}")
async def delete_render(request: Request, render_id: str):
    user = _get_user(request)
    if not database.delete_render(user, render_id):
        raise HTTPException(404, "Render not found")
    return {"status": "deleted"}


# ── Presets ──

class PresetData(BaseModel):
    name: str
    style_json: str
    template_id: str | None = None


@router.get("/api/presets")
async def list_presets(request: Request):
    user = _get_user(request)
    return {"presets": database.list_presets(user)}


@router.post("/api/presets")
async def create_preset(request: Request, data: PresetData):
    user = _get_user(request)
    return database.save_preset(user, data.name, data.style_json, data.template_id)


@router.delete("/api/presets/{preset_id}")
async def delete_preset(request: Request, preset_id: str):
    user = _get_user(request)
    if not database.delete_preset(user, preset_id):
        raise HTTPException(404, "Preset not found")
    return {"status": "deleted"}


# ── Settings ──

class SettingsData(BaseModel):
    whisper_model: str | None = None
    default_template: str | None = None
    default_style_json: str | None = None
    render_quality: str | None = None


@router.get("/api/settings")
async def get_settings(request: Request):
    user = _get_user(request)
    return database.get_settings(user)


@router.put("/api/settings")
async def update_settings(request: Request, data: SettingsData):
    user = _get_user(request)
    return database.update_settings(user, data.model_dump(exclude_none=True))


# ── Stats ──

@router.get("/api/stats")
async def get_stats(request: Request):
    user = _get_user(request)
    return database.get_stats(user)