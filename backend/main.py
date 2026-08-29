"""RapTok API — main FastAPI app (thin entry point)."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import health, files, video, subtitles, audio, transcription, render

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="RapTok API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
for r in (health, files, video, subtitles, audio, transcription, render):
    app.include_router(r.router)

logger.info("RapTok API started — routers: health, files, video, subtitles, audio, transcription, render")