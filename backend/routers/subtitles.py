"""Subtitle splitting + adjustment router."""
from fastapi import APIRouter
from models.schemas import SubtitleRequest, WordSubtitleRequest, SubtitleAdjustRequest, WordTiming
from services.subtitle_generator import split_lyrics, split_lyrics_word_level
from routers.helpers import parse_fragments, parse_word_timings

router = APIRouter()


@router.post("/api/subtitles/split")
async def api_split_subtitles(req: SubtitleRequest):
    """Split lyrics into subtitle lines mapped to fragments."""
    fragments = parse_fragments(req.fragments)
    subtitles = split_lyrics(req.lyrics, fragments)
    return {"subtitles": [s.model_dump() for s in subtitles]}


@router.post("/api/subtitles/word-split")
async def api_word_split_subtitles(req: WordSubtitleRequest):
    """Split lyrics into word-level subtitles with karaoke timing."""
    fragments = parse_fragments(req.fragments)
    word_timings = parse_word_timings(req.word_timings)

    # Apply audio_start offset: word timings are absolute, video timeline starts at 0
    if word_timings and req.audio_start > 0:
        adjusted = []
        for wt in word_timings:
            new_start = wt.start - req.audio_start
            new_end = wt.end - req.audio_start
            if new_end > 0:
                adjusted.append(WordTiming(
                    word=wt.word,
                    start=round(max(0, new_start), 3),
                    end=round(new_end, 3),
                    probability=wt.probability,
                ))
        word_timings = adjusted

    subtitles = split_lyrics_word_level(
        lyrics=req.lyrics,
        fragments=fragments,
        word_timings=word_timings if word_timings else None,
    )
    return {"subtitles": [s.model_dump() for s in subtitles]}


@router.post("/api/subtitles/adjust")
async def api_adjust_subtitles(req: SubtitleAdjustRequest):
    """Apply global stretch/offset to word timings and regenerate subtitles."""
    fragments = parse_fragments(req.fragments)
    word_timings = parse_word_timings(req.word_timings)

    stretch = req.stretch
    offset = req.audio_start

    if word_timings and (stretch != 1.0 or offset != 0.0):
        adjusted = []
        for wt in word_timings:
            new_start = wt.start * stretch + offset
            new_end = wt.end * stretch + offset
            if new_end > 0:
                adjusted.append(WordTiming(
                    word=wt.word,
                    start=round(max(0, new_start), 3),
                    end=round(new_end, 3),
                ))
        word_timings = adjusted

    subtitles = split_lyrics_word_level(
        lyrics=req.lyrics,
        fragments=fragments,
        word_timings=word_timings if word_timings else None,
    )
    return {
        "subtitles": [s.model_dump() for s in subtitles],
        "words": [w.model_dump() for w in word_timings],
    }