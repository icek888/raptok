"""Subtitle generator — split lyrics and create ASS subtitle file."""
from models.schemas import SubtitleLine, SubtitleStyle
from pathlib import Path
from config import TEMP_DIR


def split_lyrics(lyrics: str, fragments: list) -> list[SubtitleLine]:
    """
    Split lyrics text into lines and assign each to a fragment's time slot.
    Multiple lines per fragment if the fragment is long enough.
    """
    # Split by newlines, filter empty
    raw_lines = [line.strip() for line in lyrics.split("\n") if line.strip()]
    
    # Calculate total duration
    total_dur = sum(f.duration for f in fragments)
    
    # Distribute lines across fragments proportionally
    subtitles = []
    line_idx = 0
    current_time = 0.0
    
    for frag in fragments:
        # How many lines fit in this fragment? ~1 line per 2-3 seconds
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


def generate_ass(subtitles: list[SubtitleLine], style: SubtitleStyle, job_id: str = "subs") -> str:
    """
    Generate an ASS subtitle file with the given style.
    Returns path to the .ass file.
    """
    output_path = TEMP_DIR / f"{job_id}.ass"
    
    # ASS color format: &HAA BBGGRR (alpha + BGR)
    # Convert from &H00BBGGRR to ASS format
    primary = style.primary_color
    outline = style.outline_color
    
    # Position: bottom=7, center=8, top=9 in ASS alignment
    alignment_map = {"bottom": 2, "center": 8, "top": 10}
    alignment = alignment_map.get(style.position, 2)
    
    bold_flag = "-1" if style.bold else "0"
    
    ass_header = f"""[Script Info]
Script Type: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style.font},{style.size},{primary},&H000000FF,{outline},&H64000000,{bold_flag},0,0,0,100,100,0,0,1,{style.outline_width},2,{alignment},60,60,120,1

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
    for sub in subtitles:
        start = _format_time(sub.start)
        end = _format_time(sub.end)
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{sub.text}")
    
    ass_content = ass_header + "\n".join(events) + "\n"
    
    output_path.write_text(ass_content, encoding="utf-8")
    return str(output_path)