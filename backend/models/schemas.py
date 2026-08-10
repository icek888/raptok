"""Pydantic models for RapTok API."""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class VideoSource(str, Enum):
    youtube = "youtube"
    rezka = "rezka"
    direct = "direct"


class AnalyzeRequest(BaseModel):
    url: str = Field(..., description="Video URL (YouTube, rezka.ag, or direct mp4/m3u8)")


class VideoInfo(BaseModel):
    url: str
    source: VideoSource
    title: str
    duration: float
    width: int
    height: int
    local_path: str
    job_id: str


class Fragment(BaseModel):
    id: int
    start: float
    end: float
    duration: float
    thumbnail: Optional[str] = None


class FragmentSelection(BaseModel):
    fragments: list[Fragment]
    total_duration: float


class FragmentSelectRequest(BaseModel):
    duration: float = Field(..., description="Video duration in seconds")
    count: int = Field(default=7, ge=3, le=10)
    min_frag: float = Field(default=3.0, ge=1.0, le=10.0)
    max_frag: float = Field(default=5.0, ge=2.0, le=15.0)
    seed: Optional[int] = None


class FragmentReplaceRequest(BaseModel):
    duration: float
    fragments: list[Fragment]
    fragment_id: int
    new_start: float
    frag_duration: float = Field(default=4.0, ge=1.0, le=15.0)


class SubtitleStyle(BaseModel):
    font: str = "Arial"
    size: int = 48
    primary_color: str = "&H00FFFFFF"  # white
    outline_color: str = "&H00000000"  # black
    outline_width: int = 3
    position: str = "bottom"  # bottom, center, top
    bold: bool = True


class SubtitleLine(BaseModel):
    id: int
    start: float
    end: float
    text: str


class SubtitleRequest(BaseModel):
    lyrics: str
    fragments: list[Fragment]
    style: SubtitleStyle = SubtitleStyle()


class RenderRequest(BaseModel):
    video_path: str
    fragments: list[Fragment]
    audio_path: str
    subtitles: list[SubtitleLine]
    style: SubtitleStyle = SubtitleStyle()


class RenderStatus(BaseModel):
    job_id: str
    status: str  # pending, rendering, completed, error
    progress: float = 0.0
    output_path: Optional[str] = None
    error: Optional[str] = None