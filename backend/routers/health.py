"""Health + templates router."""
from fastapi import APIRouter
from models.schemas import TEMPLATES

router = APIRouter()


@router.get("/health")
@router.get("/api/health")
async def health():
    return {"status": "ok", "service": "raptok", "version": "0.1.0"}


@router.get("/api/templates")
async def get_templates():
    """Return available render templates."""
    return {"templates": [t.model_dump() for t in TEMPLATES]}