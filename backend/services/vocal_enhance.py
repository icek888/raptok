"""
Vocal enhancement — clean up audio before transcription.

Uses Resemble Enhance (denoiser + enhancer) or ClearerVoice Studio
to improve vocal quality for better WhisperX accuracy.

Disabled by default (CPU-heavy). Enable via RAPTOK_VOCAL_ENHANCE=1.
"""
import os
import tempfile
import subprocess
import logging
from typing import Optional
from services.features import get_flags

logger = logging.getLogger(__name__)


def is_available() -> bool:
    """Check if vocal enhancement is enabled."""
    return get_flags().vocal_enhance_enabled


def enhance_audio(audio_path: str) -> str:
    """
    Enhance audio quality. Returns path to enhanced audio file.
    If enhancement fails or is disabled, returns original path.

    Args:
        audio_path: path to input audio file

    Returns:
        path to enhanced audio file (or original if enhancement skipped)
    """
    flags = get_flags()
    if not flags.vocal_enhance_enabled:
        return audio_path

    method = flags.vocal_enhance_method

    try:
        if method == "resemble":
            return _enhance_with_resemble(audio_path)
        elif method == "clearervoice":
            return _enhance_with_clearervoice(audio_path)
        else:
            logger.warning(f"Unknown enhance method: {method}, skipping")
            return audio_path
    except Exception as e:
        logger.warning(f"Vocal enhancement failed (non-fatal): {e}")
        return audio_path


def _enhance_with_resemble(audio_path: str) -> str:
    """Enhance using Resemble Enhance."""
    try:
        from resemble_enhance.enhancer.inference import enhance
        import torch
        import torchaudio

        # Load audio
        waveform, sr = torchaudio.load(audio_path)

        # Enhance
        enhanced = enhance(waveform, sr)

        # Save
        output = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        torchaudio.save(output.name, enhanced, sr)
        logger.info(f"Vocal enhanced (Resemble): {audio_path} → {output.name}")
        return output.name

    except ImportError:
        logger.info("resemble_enhance not installed, using ffmpeg fallback")
        return _enhance_with_ffmpeg(audio_path)


def _enhance_with_clearervoice(audio_path: str) -> str:
    """Enhance using ClearerVoice Studio."""
    try:
        from clearvoice import ClearVoice  # type: ignore

        clearvoice = ClearVoice()
        result = clearvoice.enhance(audio_path)
        if isinstance(result, str) and os.path.exists(result):
            logger.info(f"Vocal enhanced (ClearerVoice): {audio_path} → {result}")
            return result
        return audio_path
    except ImportError:
        logger.info("clearvoice not installed, using ffmpeg fallback")
        return _enhance_with_ffmpeg(audio_path)


def _enhance_with_ffmpeg(audio_path: str) -> str:
    """Lightweight ffmpeg-based enhancement: denoise + normalize."""
    output = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    # ffmpeg denoise filter + loudness normalization
    result = subprocess.run([
        "ffmpeg", "-y",
        "-i", audio_path,
        "-af", "highpass=f=80,lowpass=f=8000,"
               "afftdn=nr=12:nf=-40,"
               "loudnorm=I=-16:TP=-1.5:LRA=11,"
               "acompressor=threshold=-20dB:ratio=2:attack=5:release=50",
        "-ar", "16000",  # 16kHz for whisper
        "-ac", "1",      # mono
        output.name,
    ], capture_output=True, timeout=120)

    if result.returncode == 0:
        logger.info(f"Vocal enhanced (ffmpeg): {audio_path} → {output.name}")
        return output.name
    else:
        logger.warning(f"ffmpeg enhance failed: {result.stderr[:200]}")
        os.unlink(output.name)
        return audio_path


def enhance_if_enabled(audio_path: str) -> str:
    """Safe wrapper — always returns a valid path."""
    try:
        return enhance_audio(audio_path)
    except Exception as e:
        logger.warning(f"Enhancement wrapper error (non-fatal): {e}")
        return audio_path