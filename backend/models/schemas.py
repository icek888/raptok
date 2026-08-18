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
    primary_color: str = "&H00FFFFFF"  # white (inactive text)
    active_color: str = "&H00D7FF"  # yellow (active word highlight)
    outline_color: str = "&H00000000"  # black
    outline_width: int = 4
    position: str = "bottom"  # bottom, center, top
    margin_v: int = 80  # vertical margin from edge (px in 1080x1920 space)
    bold: bool = True


# ─── Render Templates ───

class RenderTemplate(BaseModel):
    """Predefined render template — controls subtitles + video look."""
    id: str
    name: str
    description: str
    # Subtitle style
    font: str
    size: int
    primary_color: str
    active_color: str
    outline_color: str
    outline_width: int
    position: str
    margin_v: int
    bold: bool
    # Video rendering
    video_mode: str = "fit_blur"   # fit_blur, crop_fill, fit_blur_dark
    blur_sigma: int = 20       # background blur strength
    dark_overlay: float = 0.0  # 0.0-1.0, darkens background video
    scale_factor: float = 1.0  # 1.0 = full width, 0.85 = smaller video
    display_mode: str = "line_highlight"
    karaoke: bool = True
    # ASS effects
    active_scale: int = 130    # % scale for active word (130 = 1.3x)
    glow_border: int = 0       # 0 = none, >0 = glow border width
    fade_in: bool = False      # fade in each word


TEMPLATES = [
    RenderTemplate(
        id="cinematic",
        name="Cinematic",
        description="Clear 16:9 video centered, blurred video as background",
        font="Montserrat",
        size=68,
        primary_color="&H00FFFFFF",   # white
        active_color="&H0017D6FF",    # gold (#FFD717 in RGB → BGR)
        outline_color="&H00000000",   # black
        outline_width=3,
        position="bottom",
        margin_v=140,
        bold=True,
        video_mode="fit_blur",        # clear video centered, blurred bg
        blur_sigma=25,
        dark_overlay=0.0,             # no dark overlay — see bg clearly
        scale_factor=1.0,
        display_mode="line_highlight",
        karaoke=True,
        active_scale=130,
        glow_border=0,
        fade_in=False,
    ),
    RenderTemplate(
        id="big_words",
        name="Big Words",
        description="Full-screen zoomed video, huge text, no black bars",
        font="Oswald",
        size=110,
        primary_color="&H00FFFFFF",   # white
        active_color="&H00FFE600",    # cyan (#00E5FF → BGR)
        outline_color="&H00000000",   # black
        outline_width=5,
        position="center",
        margin_v=0,
        bold=True,
        video_mode="crop_fill",       # zoom to fill 9:16, no bars
        blur_sigma=0,                 # no blur — full screen video
        dark_overlay=0.0,
        scale_factor=1.0,
        display_mode="single_word",
        karaoke=True,
        active_scale=140,
        glow_border=0,
        fade_in=True,
    ),
    RenderTemplate(
        id="neon_pop",
        name="Neon Pop",
        description="Clear video center, dark blurred background, neon glow",
        font="Russo One",
        size=85,
        primary_color="&H00FFFFFF",   # white
        active_color="&H0020D6E6",    # neon pink (#E6D620 → BGR)
        outline_color="&H000A0A0A",   # near-black
        outline_width=2,
        position="center",
        margin_v=200,
        bold=True,
        video_mode="fit_blur_dark",   # clear video + dark blurred bg
        blur_sigma=50,
        dark_overlay=0.55,
        scale_factor=0.85,
        display_mode="single_word",
        karaoke=True,
        active_scale=150,
        glow_border=12,
        fade_in=False,
    ),
]


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
    template_id: str = ""  # If set, overrides style/display_mode with template


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