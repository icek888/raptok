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
    size: int = 72
    primary_color: str = "&H00FFFFFF"  # white
    outline_color: str = "&H00000000"  # black
    outline_width: int = 4
    position: str = "bottom"  # bottom, center, top
    bold: bool = True


class WordTiming(BaseModel):
    word: str
    start: float
    end: float
    probability: Optional[float] = None


class SubtitleLine(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: Optional[list[WordTiming]] = None


class SubtitleRequest(BaseModel):
    lyrics: str
    fragments: list[Fragment]
    style: SubtitleStyle = SubtitleStyle()


class RenderRequest(BaseModel):
    video_path: str
    fragments: list[Fragment]
    audio_path: str
    audio_start: float = Field(default=0.0, description="Start offset in audio file (seconds)")
    subtitles: list[SubtitleLine]
    style: SubtitleStyle = SubtitleStyle()
    karaoke: bool = False
    display_mode: str = "line_highlight"


class RenderStatus(BaseModel):
    job_id: str
    status: str  # pending, rendering, completed, error
    progress: float = 0.0
    output_path: Optional[str] = None
    error: Optional[str] = None


# ─── New: BPM & Beat Sync ───

class BPMRequest(BaseModel):
    audio_path: str


class BPMResult(BaseModel):
    bpm: float
    bpm_raw: float = 0.0
    bpm_half: float = 0.0
    bpm_double: float = 0.0
    beats: list[float]
    downbeats: list[float]
    duration: float


class BeatSyncRequest(BaseModel):
    audio_path: str
    duration: float  # video duration
    count: int = Field(default=7, ge=3, le=10)
    beat_division: str = Field(default="1/4", description="1/1, 1/2, 1/4, 1/8, 1/16")
    min_frag: float = Field(default=2.0, ge=0.5, le=10.0)
    max_frag: float = Field(default=5.0, ge=1.0, le=15.0)


class BeatSyncResult(BaseModel):
    bpm: float
    beats: list[float]
    fragments: list[Fragment]
    total_duration: float


# ─── New: Speech Recognition ───

class TranscribeRequest(BaseModel):
    audio_path: str
    language: str = Field(default="en", description="Language code: en, ru, auto")


class TranscribeResult(BaseModel):
    text: str
    lines: list[dict]  # [{text, start, end, words: [{word, start, end}]}]
    words: list[WordTiming]
    language: str


# ─── New: Word-level subtitle split ───

class SubtitleAdjustRequest(BaseModel):
    lyrics: str = ""
    fragments: list[Fragment]
    word_timings: Optional[list[WordTiming]] = None
    audio_start: float = Field(default=0.0, description="Global offset in seconds")
    stretch: float = Field(default=1.0, description="Stretch factor (0.5 = 2x slower, 2.0 = 2x faster)")
    style: SubtitleStyle = SubtitleStyle()


class WordSubtitleRequest(BaseModel):
    lyrics: str = ""
    fragments: list[Fragment]
    word_timings: Optional[list[WordTiming]] = None
    style: SubtitleStyle = SubtitleStyle()
    audio_start: float = Field(default=0.0, description="Audio start offset — subtract from word timings to map to video timeline")