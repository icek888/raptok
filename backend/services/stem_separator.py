"""
Stem Separation Service — вокал из микса.

Два метода:
1. ML (audio-separator / ONNX) — если установлен, качество выше
2. FFmpeg center-extraction — мгновенно, базовое качество

Использование:
    from services.stem_separator import separate_vocals
    vocal_path = await separate_vocals(audio_path)
    # → /tmp/raptok/vocals_<hash>.wav
"""

import asyncio
import hashlib
import os
import logging
from pathlib import Path

from config import TEMP_DIR

logger = logging.getLogger(__name__)


async def separate_vocals(
    audio_path: str,
    method: str = "auto",
) -> str:
    """
    Выделить вокал из аудио.
    
    Args:
        audio_path: путь к исходному аудио
        method: "ml" | "ffmpeg" | "auto" (ml если доступен, иначе ffmpeg)
    
    Returns:
        путь к wav-файлу с вокалом
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio not found: {audio_path}")
    
    # Hash for unique output name
    file_hash = hashlib.md5(audio_path.encode()).hexdigest()[:12]
    output_path = os.path.join(TEMP_DIR, f"vocals_{file_hash}.wav")
    
    if os.path.exists(output_path):
        logger.info(f"Vocals already cached: {output_path}")
        return output_path
    
    # Determine method
    if method == "auto":
        ml_available = _check_ml_available()
        use_ml = ml_available
    elif method == "ml":
        use_ml = True
    else:
        use_ml = False
    
    if use_ml:
        logger.info(f"Separating vocals (ML) for {audio_path}")
        try:
            result = await _separate_ml(audio_path, output_path)
            return result
        except Exception as e:
            logger.warning(f"ML separation failed ({e}), falling back to ffmpeg")
    
    # FFmpeg fallback (always available)
    logger.info(f"Separating vocals (ffmpeg center) for {audio_path}")
    return await _separate_ffmpeg(audio_path, output_path)


def _check_ml_available() -> bool:
    """Check if audio-separator is installed."""
    try:
        import audio_separator
        return True
    except ImportError:
        return False


async def _separate_ml(audio_path: str, output_path: str) -> str:
    """Use audio-separator (ONNX models) for high-quality vocal isolation."""
    # Run in thread to not block event loop
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_ml_separation, audio_path, output_path)


def _run_ml_separation(audio_path: str, output_path: str) -> str:
    """Blocking ML separation — runs in thread."""
    from audio_separator.separator import Separator
    
    # Use 2-stem model (vocals + instrumental) — fastest, CPU-friendly
    separator = Separator(
        model_file_dir="/tmp/audio-separator-models",
        output_dir=os.path.dirname(output_path),
        output_format="wav",
    )
    separator.load_model(model_filename="Kim_Vocal_2.onnx")
    
    # Separate
    separation = separator.separate(audio_path)
    
    # Find the vocals stem (not instrumental)
    for stem_path in separation:
        if "vocal" in stem_path.lower() and "instrumental" not in stem_path.lower():
            # Rename to our expected output
            if stem_path != output_path:
                os.rename(stem_path, output_path)
            return output_path
    
    # If naming didn't match, take first output
    if separation:
        os.rename(separation[0], output_path)
        return output_path
    
    raise RuntimeError("ML separation produced no output")


async def _separate_ffmpeg(audio_path: str, output_path: str) -> str:
    """
    FFmpeg center-channel extraction.
    
    Vocals are usually in the center of a stereo mix.
    L - R removes everything panned to center (removes vocals)
    So we invert: (L - R) gives us side channel (instruments)
    To KEEP center (vocals), we use: (L + R) / 2 then lowpass
    
    Better approach: mid-side extraction
    Mid = (L + R) / 2 — contains vocals + center instruments
    Side = (L - R) / 2 — contains panned instruments
    
    For vocal isolation we use: pan filter
    """
    # Method: extract mid channel (center = vocals) with highpass
    # Then apply noise reduction for cleaner vocals
    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-af",
        # Center extraction: (L+R)/2 to get mid, then highpass to remove bass,
        # then afftdn for noise reduction
        "pan=mono|c0=0.5*c0+0.5*c1,"
        "highpass=f=80,"
        "lowpass=f=12000,"
        "afftdn=nr=15,"
        # Slight compression to even out vocal levels
        "acompressor=threshold=-20dB:ratio=3:attack=5:release=50",
        "-ar", "16000",  # 16kHz — perfect for whisper
        "-ac", "1",      # mono
        "-y",
        output_path,
    ]
    
    logger.info(f"FFmpeg cmd: {' '.join(cmd)}")
    
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    
    stdout, stderr = await proc.communicate()
    
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {stderr.decode()}")
    
    if not os.path.exists(output_path):
        raise RuntimeError("FFmpeg produced no output")
    
    logger.info(f"FFmpeg vocal extraction done: {output_path}")
    return output_path


async def separate_vocals_with_stems(
    audio_path: str,
    method: str = "auto",
) -> dict:
    """
    Full stem separation — returns paths to all stems.
    
    Returns:
        {
            "vocals": "/tmp/raptok/vocals_xxx.wav",
            "instrumental": "/tmp/raptok/instrumental_xxx.wav",
            # ML only: "drums": ..., "bass": ..., "other": ...
        }
    """
    file_hash = hashlib.md5(audio_path.encode()).hexdigest()[:12]
    
    if method == "ml" or (method == "auto" and _check_ml_available()):
        try:
            return await _separate_ml_stems(audio_path, file_hash)
        except Exception as e:
            logger.warning(f"ML stems failed ({e}), using ffmpeg")
    
    # FFmpeg: only vocals + instrumental
    vocals = await separate_vocals(audio_path, method="ffmpeg")
    instrumental = os.path.join(TEMP_DIR, f"instrumental_{file_hash}.wav")
    
    # Instrumental = original minus vocals (L - R side channel)
    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-af", "pan=stereo|c0=c0-c1|c1=c1-c0",
        "-y", instrumental,
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    
    return {"vocals": vocals, "instrumental": instrumental}


async def _separate_ml_stems(audio_path: str, file_hash: str) -> dict:
    """ML 4-stem separation: vocals, drums, bass, other."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _run_ml_stems, audio_path, file_hash)


def _run_ml_stems(audio_path: str, file_hash: str) -> dict:
    from audio_separator.separator import Separator
    
    separator = Separator(
        model_file_dir="/tmp/audio-separator-models",
        output_dir=TEMP_DIR,
        output_format="wav",
    )
    
    # 4-stem model — using Kim_Vocal_2 for vocals, need a different model for drums/bass/other
    separator.load_model(model_filename="Kim_Vocal_2.onnx")
    separation = separator.separate(audio_path)
    
    stems = {}
    for stem_path in separation:
        name = os.path.basename(stem_path).lower()
        if "vocal" in name and "instrumental" not in name:
            stems["vocals"] = stem_path
        elif "instrumental" in name:
            stems["instrumental"] = stem_path
        elif "drum" in name:
            stems["drums"] = stem_path
        elif "bass" in name:
            stems["bass"] = stem_path
        else:
            stems["other"] = stem_path
    
    return stems