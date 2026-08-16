"""Forced alignment — map user-provided lyrics onto whisper word timings.

Instead of using whisper's recognized text (which may differ from the actual lyrics),
we use whisper ONLY for timing information, then align the user's lyrics
(words with original punctuation/spacing) onto those timings.

Strategy:
1. Transcribe audio with whisper → get word_timings (recognized words + start/end)
2. Parse user lyrics into words (preserving original punctuation)
3. Align user words to whisper timings using:
   - DTW (Dynamic Time Warping) on word count ratios
   - Or simple proportional distribution if counts differ
4. Output: user's words with whisper's timing
"""
import re
from models.schemas import WordTiming


def _tokenize_lyrics(text: str) -> list[str]:
    """Split lyrics into words, preserving original punctuation."""
    words = text.split()
    return [w for w in words if w]


def _normalize_word(word: str) -> str:
    """Normalize word for comparison — lowercase, strip punctuation."""
    return re.sub(r'[^\w\u0400-\u04FF]', '', word.lower().strip())


def _group_lyrics_lines(text: str) -> list[list[str]]:
    """Split lyrics into lines (by newline), then each line into words.
    This preserves the user's intended line breaks for subtitle grouping.
    Returns list of lines, each a list of words.
    """
    lines = []
    for line in text.split('\n'):
        words = _tokenize_lyrics(line)
        if words:
            lines.append(words)
    return lines


def align_lyrics_to_timings(
    lyrics_text: str,
    whisper_words: list[dict],
) -> list[WordTiming]:
    """Align user-provided lyrics onto whisper word timings."""
    user_words = _tokenize_lyrics(lyrics_text)
    if not user_words or not whisper_words:
        return []

    whisper_norm = [_normalize_word(w["word"]) for w in whisper_words]
    whisper_starts = [w["start"] for w in whisper_words]
    whisper_ends = [w["end"] for w in whisper_words]
    user_norm = [_normalize_word(w) for w in user_words]

    # Strategy 1: Exact count match — direct mapping
    if len(user_words) == len(whisper_words):
        return [
            WordTiming(
                word=user_words[i],
                start=round(whisper_starts[i], 3),
                end=round(whisper_ends[i], 3),
            )
            for i in range(len(user_words))
        ]

    # Strategy 2: DTW alignment
    aligned = _dtw_align(user_words, user_norm, whisper_words, whisper_norm)
    if aligned and len(aligned) >= len(user_words) * 0.5:
        return aligned

    # Strategy 3: Proportional distribution
    return _proportional_distribute(
        user_words, whisper_words, whisper_starts, whisper_ends
    )


def _dtw_align(
    user_words: list[str],
    user_norm: list[str],
    whisper_words: list[dict],
    whisper_norm: list[str],
) -> list[WordTiming] | None:
    """DTW alignment between user words and whisper words."""
    n = len(user_words)
    m = len(whisper_words)
    if n == 0 or m == 0:
        return None
    if n > m * 2 or m > n * 2:
        return None

    INF = float('inf')
    cost = [[INF] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match_cost = 0 if user_norm[i-1] == whisper_norm[j-1] else 1
            cost[i][j] = match_cost + min(
                cost[i-1][j],
                cost[i][j-1],
                cost[i-1][j-1],
            )

    i, j = n, m
    pairs = []
    while i > 0 and j > 0:
        match_cost = 0 if user_norm[i-1] == whisper_norm[j-1] else 1
        if cost[i-1][j-1] + match_cost == cost[i][j]:
            pairs.append((i-1, j-1))
            i -= 1
            j -= 1
        elif cost[i-1][j] + 1 == cost[i][j]:
            i -= 1
        else:
            j -= 1

    pairs.reverse()
    if not pairs:
        return None

    result = []
    for u_idx, w_idx in pairs:
        result.append(WordTiming(
            word=user_words[u_idx],
            start=round(whisper_words[w_idx]["start"], 3),
            end=round(whisper_words[w_idx]["end"], 3),
        ))
    return result


def _proportional_distribute(
    user_words: list[str],
    whisper_words: list[dict],
    whisper_starts: list[float],
    whisper_ends: list[float],
) -> list[WordTiming]:
    """Distribute user words proportionally across whisper timing."""
    n = len(user_words)
    if not whisper_starts or not whisper_ends:
        return []

    total_start = whisper_starts[0]
    total_end = whisper_ends[-1]
    total_dur = total_end - total_start
    if total_dur <= 0:
        return []

    avg_dur = total_dur / n
    result = []
    for i in range(n):
        word_start = total_start + i * avg_dur
        word_end = word_start + avg_dur
        result.append(WordTiming(
            word=user_words[i],
            start=round(max(total_start, word_start), 3),
            end=round(min(total_end, word_end), 3),
        ))
    return result


def _bpm_aware_distribute(
    user_words: list[str],
    fragment_duration: float,
    bpm: float = 0.0,
    beats: list[float] | None = None,
) -> list[WordTiming]:
    """
    Distribute words across fragment using BPM beat grid.
    
    Instead of uniform distribution (which makes everything too fast),
    we snap words to beat positions. Each word gets at least 1 beat duration.
    
    For 77 BPM: 1 beat = 60/77 = 0.78s. 85 words × 0.78s = 66s (fits a 30s fragment
    only if we use half-beats: 0.39s/word → 85 × 0.39 = 33s ≈ 30s ✓)
    
    If no BPM/beats, fall back to even distribution but with a minimum
    word duration of 0.3s (not less than 200ms per word).
    """
    n = len(user_words)
    if n == 0 or fragment_duration <= 0:
        return []

    if bpm > 0:
        # Beat duration in seconds
        beat_dur = 60.0 / bpm
        
        # How many words fit per beat? 
        # Try: 1 word per beat, 2 words per beat, etc.
        # Find the distribution that best fills the fragment
        words_per_beat = max(1, round(n * beat_dur / fragment_duration))
        word_dur = beat_dur / words_per_beat
        
        # If word_dur is too short (< 0.15s), just use even distribution
        if word_dur < 0.15:
            word_dur = max(0.2, fragment_duration / n)
    else:
        # No BPM — even distribution with minimum 0.2s per word
        word_dur = max(0.2, fragment_duration / n)
    
    # Use beats if available for non-uniform distribution
    if beats and len(beats) > 1 and bpm > 0:
        result = []
        beat_idx = 0
        for i, w in enumerate(user_words):
            # Find which beat this word falls on
            target_time = i * word_dur
            
            # Snap to nearest beat if close
            while beat_idx < len(beats) - 1 and beats[beat_idx] < target_time:
                beat_idx += 1
            
            if beat_idx < len(beats):
                w_start = beats[beat_idx]
            else:
                w_start = target_time
            
            w_end = w_start + word_dur
            result.append(WordTiming(
                word=w,
                start=round(w_start, 3),
                end=round(min(fragment_duration, w_end), 3),
            ))
        return result
    
    # Even distribution with BPM-aware word duration
    result = []
    for i, w in enumerate(user_words):
        w_start = i * word_dur
        w_end = w_start + word_dur
        result.append(WordTiming(
            word=w,
            start=round(w_start, 3),
            end=round(min(fragment_duration, w_end), 3),
        ))
    return result


def merge_transcription_with_lyrics(
    whisper_result: dict,
    lyrics_text: str,
    audio_start: float = 0.0,
    fragment_duration: float = 0.0,
    bpm: float = 0.0,
    beats: list[float] | None = None,
) -> tuple[list[WordTiming], str]:
    """
    Full pipeline: take whisper transcription, align user lyrics onto it.
    
    Args:
        whisper_result: whisper output with "words" list
        lyrics_text: user-provided lyrics
        audio_start: offset (usually 0 since fragment already extracted)
        fragment_duration: total duration of the selected audio fragment
        bpm: BPM for beat-aware distribution (when whisper fails)
        beats: beat positions for beat-snapping
    """
    whisper_words = whisper_result.get("words", [])
    
    if not lyrics_text.strip():
        # No user lyrics — return whisper's own words
        words = [
            WordTiming(
                word=w["word"],
                start=round(w["start"], 3),
                end=round(w["end"], 3),
            )
            for w in whisper_words
        ]
    else:
        # Align user lyrics onto whisper timings
        words = align_lyrics_to_timings(lyrics_text, whisper_words)
        
        # CRITICAL FIX: If whisper only recognized a small portion of the fragment
        # (e.g., 2 seconds out of 30), use BPM-aware distribution instead of
        # uniform distribution which makes karaoke too fast.
        if fragment_duration > 0:
            # Check if whisper coverage is poor
            whisper_end = whisper_words[-1]["end"] if whisper_words else 0
            whisper_coverage = whisper_end / fragment_duration if fragment_duration > 0 else 0
            
            if whisper_coverage < 0.5 or not words:
                # Whisper only recognized < 50% of fragment
                # Use BPM-aware distribution across full fragment
                user_word_list = _tokenize_lyrics(lyrics_text)
                words = _bpm_aware_distribute(
                    user_word_list,
                    fragment_duration,
                    bpm=bpm,
                    beats=beats,
                )
    
    # Adjust for audio_start offset
    if audio_start > 0:
        adjusted = []
        for w in words:
            adj_start = w.start - audio_start
            adj_end = w.end - audio_start
            if adj_end > 0:
                adjusted.append(WordTiming(
                    word=w.word,
                    start=round(max(0, adj_start), 3),
                    end=round(adj_end, 3),
                ))
        words = adjusted
    
    return words, lyrics_text