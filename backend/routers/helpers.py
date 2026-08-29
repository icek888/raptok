"""Shared helper utilities for routers."""
from models.schemas import Fragment, WordTiming, SubtitleLine


def parse_fragments(raw) -> list[Fragment]:
    """Convert list of dicts/Fragment objects into a list of Fragment."""
    return [Fragment(**f) if isinstance(f, dict) else f for f in raw]


def parse_word_timings(raw) -> list[WordTiming]:
    """Convert list of dicts/WordTiming objects into a list of WordTiming."""
    return [WordTiming(**w) if isinstance(w, dict) else w for w in (raw or [])]


def parse_subtitles(raw) -> list[SubtitleLine]:
    """Convert list of dicts/SubtitleLine objects into a list of SubtitleLine."""
    return [SubtitleLine(**s) if isinstance(s, dict) else s for s in raw]