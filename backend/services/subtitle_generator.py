"""Subtitle generator — split lyrics, create ASS with word-by-word karaoke sync."""
from models.schemas import SubtitleLine, SubtitleStyle, WordTiming
from pathlib import Path
from config import TEMP_DIR


def _tokenize_lyrics(text: str) -> list[str]:
    """Split lyrics line into words, preserving punctuation."""
    return [w for w in text.split() if w]


def split_lyrics(lyrics: str, fragments: list) -> list[SubtitleLine]:
    """
    Split lyrics text into lines and assign each to a fragment's time slot.
    Multiple lines per fragment if the fragment is long enough.
    """
    raw_lines = [line.strip() for line in lyrics.split("\n") if line.strip()]
    
    total_dur = sum(f.duration for f in fragments)
    
    subtitles = []
    line_idx = 0
    current_time = 0.0
    
    for frag in fragments:
        lines_per_frag = max(1, int(frag.duration / 2.5))
        
        for i in range(lines_per_frag):
            if line_idx >= len(raw_lines):
                break
            
            line_start = current_time + (i * frag.duration / lines_per_frag)
            line_end = current_time + ((i + 1) * frag.duration / lines_per_frag)
            
            subtitles.append(SubtitleLine(
                id=len(subtitles),
                start=round(line_start, 2),
                end=round(line_end, 2),
                text=raw_lines[line_idx],
            ))
            line_idx += 1
        
        current_time += frag.duration
    
    return subtitles


def split_lyrics_word_level(
    lyrics: str,
    fragments: list,
    word_timings: list[WordTiming] | None = None,
) -> list[SubtitleLine]:
    """
    Split lyrics into subtitle lines with word-level karaoke timing.
    
    If word_timings is provided, use actual timestamps.
    Group words into LINES using the user's original line breaks (newlines)
    instead of arbitrary gap-based grouping. This preserves the user's
    intended visual structure.
    
    If no word_timings, distribute words evenly across fragment time slots.
    """
    if word_timings and len(word_timings) > 0:
        # Use actual word timings from speech recognition
        # Group words into lines using user's original line breaks
        user_lines = [line.strip() for line in lyrics.split('\n') if line.strip()]
        
        subtitles = []
        word_idx = 0
        
        for line_idx, user_line in enumerate(user_lines):
            line_words_from_text = _tokenize_lyrics(user_line)
            n_words_in_line = len(line_words_from_text)
            
            # Take the next n words from word_timings
            if word_idx >= len(word_timings):
                break
            
            line_word_timings = word_timings[word_idx:word_idx + n_words_in_line]
            if not line_word_timings:
                break
            
            line_text = " ".join(w.word for w in line_word_timings)
            subtitles.append(SubtitleLine(
                id=line_idx,
                start=round(line_word_timings[0].start, 3),
                end=round(line_word_timings[-1].end, 3),
                text=line_text,
                words=[WordTiming(
                    word=w.word,
                    start=round(w.start, 3),
                    end=round(w.end, 3),
                ) for w in line_word_timings],
            ))
            word_idx += n_words_in_line
        
        # If there are leftover word_timings not assigned to any user line,
        # group them into lines of max 8 words
        if word_idx < len(word_timings):
            remaining = word_timings[word_idx:]
            current_line_words = []
            for i, wt in enumerate(remaining):
                should_new_line = False
                if current_line_words:
                    gap = wt.start - current_line_words[-1].end
                    if gap > 0.3:
                        should_new_line = True
                    elif len(current_line_words) >= 8:
                        should_new_line = True
                    elif any(current_line_words[-1].word.rstrip().endswith(p) for p in ['.', '!', '?', ';', ':', ',']):
                        should_new_line = True
                
                if should_new_line:
                    line_text = " ".join(w.word for w in current_line_words)
                    subtitles.append(SubtitleLine(
                        id=len(subtitles),
                        start=round(current_line_words[0].start, 3),
                        end=round(current_line_words[-1].end, 3),
                        text=line_text,
                        words=[WordTiming(word=w.word, start=round(w.start, 3), end=round(w.end, 3)) for w in current_line_words],
                    ))
                    current_line_words = []
                
                current_line_words.append(wt)
            
            if current_line_words:
                line_text = " ".join(w.word for w in current_line_words)
                subtitles.append(SubtitleLine(
                    id=len(subtitles),
                    start=round(current_line_words[0].start, 3),
                    end=round(current_line_words[-1].end, 3),
                    text=line_text,
                    words=[WordTiming(word=w.word, start=round(w.start, 3), end=round(w.end, 3)) for w in current_line_words],
                ))
        
        return subtitles
    
    # Fallback: no word timings — split by lyrics text
    raw_lines = [line.strip() for line in lyrics.split("\n") if line.strip()]
    if not raw_lines:
        return split_lyrics(lyrics, fragments)
    
    # Split each line into words and distribute evenly within the line's time slot
    total_dur = sum(f.duration for f in fragments)
    if total_dur == 0:
        return []
    
    # Assign lines to time slots based on fragments
    subtitles = []
    line_idx = 0
    current_time = 0.0
    
    for frag in fragments:
        lines_per_frag = max(1, int(frag.duration / 2.5))
        
        for i in range(lines_per_frag):
            if line_idx >= len(raw_lines):
                break
            
            line_text = raw_lines[line_idx]
            words_in_line = line_text.split()
            
            line_start = current_time + (i * frag.duration / lines_per_frag)
            line_end = current_time + ((i + 1) * frag.duration / lines_per_frag)
            
            # Distribute words evenly within the line
            word_dur = (line_end - line_start) / max(len(words_in_line), 1)
            word_timings_list = []
            for j, word in enumerate(words_in_line):
                word_timings_list.append(WordTiming(
                    word=word,
                    start=round(line_start + j * word_dur, 3),
                    end=round(line_start + (j + 1) * word_dur, 3),
                ))
            
            subtitles.append(SubtitleLine(
                id=len(subtitles),
                start=round(line_start, 3),
                end=round(line_end, 3),
                text=line_text,
                words=word_timings_list,
            ))
            line_idx += 1
        
        current_time += frag.duration
    
    return subtitles


def generate_ass(
    subtitles: list[SubtitleLine],
    style: SubtitleStyle,
    job_id: str = "subs",
    karaoke: bool = False,
    display_mode: str = "line_highlight",
) -> str:
    """
    Generate an ASS subtitle file.
    
    display_mode:
    - "word_by_word": each word appears individually, one at a time
    - "line_highlight": full line shown, words highlight one-by-one (classic karaoke)
    """
    output_path = TEMP_DIR / f"{job_id}.ass"
    
    primary = style.primary_color
    outline = style.outline_color
    
    alignment_map = {"bottom": 2, "center": 8, "top": 10}
    alignment = alignment_map.get(style.position, 2)
    
    bold_flag = "-1" if style.bold else "0"
    
    # Karaoke highlight color (gold/yellow for active word)
    karaoke_color = "&H0000CCFF"  # warm gold
    
    ass_header = f"""[Script Info]
Script Type: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style.font},{style.size},{primary},{karaoke_color if karaoke else primary},{outline},&H64000000,{bold_flag},0,0,0,100,100,0,0,1,{style.outline_width},2,{alignment},60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    def _format_time(seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        cs = int((seconds % 1) * 100)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"
    
    events = []
    
    if karaoke:
        # ── Auto mode: choose ONE mode for the entire video ──
        # Count how many lines are "too long" vs "short"
        if display_mode == "auto":
            long_lines = 0
            short_lines = 0
            for sub in subtitles:
                if not sub.words:
                    continue
                line_text = " ".join(w.word for w in sub.words)
                num_words = len(sub.words)
                if len(line_text) > 30 or num_words > 6:
                    long_lines += 1
                else:
                    short_lines += 1
            # If majority of lines are long → single_word for ALL
            # Otherwise → line_highlight for ALL
            effective_mode = "single_word" if long_lines > short_lines else "line_highlight"
        else:
            effective_mode = display_mode
        
        for sub in subtitles:
            if not sub.words:
                start = _format_time(sub.start)
                end = _format_time(sub.end)
                events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{sub.text}")
                continue
            
            words = sub.words
            
            if effective_mode in ("word_by_word", "single_word"):
                # MODE 1: Only the active word shown at a time (matches preview)
                for i, wt in enumerate(words):
                    word_start = _format_time(wt.start)
                    word_end = _format_time(wt.end)
                    
                    # Only current word shown — big, centered, yellow
                    events.append(
                        f"Dialogue: 0,{word_start},{word_end},Default,,0,0,0,,"
                        f"{{\\fscx130\\fscy130\\1c&H00D7FF&}}{wt.word}{{\\fscx100\\fscy100\\1c&HFFFFFF&}}"
                    )
            
            else:
                # MODE 2: line_highlight — full line visible, active word yellow + bigger
                line_text = " ".join(w.word for w in words)
                num_words = len(words)
                too_long = len(line_text) > 30 or num_words > 6
                
                if too_long and num_words > 6:
                    # Split into chunks and show as separate dialogue lines
                    chunk_size = 4
                    for chunk_start_idx in range(0, num_words, chunk_size):
                        chunk = words[chunk_start_idx:chunk_start_idx + chunk_size]
                        if not chunk:
                            continue
                        chunk_start = _format_time(chunk[0].start)
                        chunk_end = _format_time(chunk[-1].end)
                        # Each word gets its own Dialogue line — active word is yellow+big
                        for i, w in enumerate(chunk):
                            w_start = _format_time(w.start)
                            w_end = _format_time(w.end)
                            events.append(
                                f"Dialogue: 0,{w_start},{w_end},Default,,0,0,0,,"
                                f"{{\\fscx130\\fscy130\\1c&H00D7FF&}}{w.word}{{\\fscx100\\fscy100\\1c&HFFFFFF&}}"
                            )
                else:
                    # Each word gets its own Dialogue — only active word visible (yellow, big)
                    for w in words:
                        w_start = _format_time(w.start)
                        w_end = _format_time(w.end)
                        events.append(
                            f"Dialogue: 0,{w_start},{w_end},Default,,0,0,0,,"
                            f"{{\\fscx130\\fscy130\\1c&H00D7FF&}}{w.word}{{\\fscx100\\fscy100\\1c&HFFFFFF&}}"
                        )
    else:
        # Regular subtitles
        for sub in subtitles:
            start = _format_time(sub.start)
            end = _format_time(sub.end)
            events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{sub.text}")
    
    ass_content = ass_header + "\n".join(events) + "\n"
    output_path.write_text(ass_content, encoding="utf-8")
    return str(output_path)