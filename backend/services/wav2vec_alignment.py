"""MMS Forced Alignment — precise word-level timestamps using multilingual Wav2Vec2.

Uses torchaudio.pipelines.MMS_FA (1.18GB multilingual model) which supports
any language by romanizing text to latin phonemes.

Pipeline:
1. Load audio (16kHz mono)
2. Romanize transcript (Russian → Latin)
3. Tokenize with MMS tokenizer
4. Get Wav2Vec2 emissions (phoneme probabilities per frame)
5. Aligner matches tokens to frames
6. Convert frame indices to word timestamps

Accuracy: ~20ms (frame-level), works on CPU.
"""
import torch
import torchaudio
import torchaudio.functional as F
import logging
import os
from models.schemas import WordTiming

logger = logging.getLogger(__name__)

# Cache model globally
_model = None
_bundle = None
_tokenizer = None
_aligner = None

# Russian → Latin transliteration map
_RU_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def _romanize(text: str) -> str:
    """Transliterate Russian/Cyrillic text to Latin for MMS_FA."""
    result = []
    for char in text.lower():
        if char in _RU_TO_LAT:
            result.append(_RU_TO_LAT[char])
        elif char.isalpha() and char in 'abcdefghijklmnopqrstuvwxyz ':
            result.append(char)
        elif char == ' ' or char == '\n':
            result.append(' ')
        # Skip punctuation and other chars
    return ''.join(result).strip()


def _get_model():
    """Load MMS_FA model once and cache it."""
    global _model, _bundle, _tokenizer, _aligner
    if _model is not None:
        return _model, _bundle, _tokenizer, _aligner
    
    _bundle = torchaudio.pipelines.MMS_FA
    _model = _bundle.get_model()
    _model.eval()
    _tokenizer = _bundle.get_tokenizer()
    _aligner = _bundle.get_aligner()
    logger.info(f"MMS_FA model loaded, labels={list(_bundle.get_labels())}")
    return _model, _bundle, _tokenizer, _aligner


def _load_audio(audio_path: str, target_sr: int = 16000):
    """Load audio file as 16kHz mono tensor."""
    import soundfile as sf
    import librosa
    
    data, sr = sf.read(audio_path, dtype='float32')
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)
    
    return torch.from_numpy(data).float().unsqueeze(0)  # [1, samples]


def align_with_mms(
    audio_path: str,
    words: list[str],
) -> list[WordTiming]:
    """
    Align a list of words to audio using MMS forced alignment.
    
    Args:
        audio_path: path to audio file
        words: list of words to align (can be Russian or English)
    
    Returns:
        list of WordTiming with precise start/end timestamps
    """
    try:
        model, bundle, tokenizer, aligner = _get_model()
        
        # Romanize all words
        romanized = [_romanize(w) for w in words]
        # Remove empty words (from punctuation-only or ь/ъ)
        word_map = []  # (original_word, romanized_word)
        for orig, rom in zip(words, romanized):
            if rom.strip():
                word_map.append((orig, rom))
        
        if not word_map:
            logger.warning("No valid words after romanization")
            return []
        
        romanized_words = [w[1] for w in word_map]
        original_words = [w[0] for w in word_map]
        
        # Tokenize
        tokenized = tokenizer(romanized_words)
        
        # Load audio
        waveform = _load_audio(audio_path, bundle.sample_rate)
        
        # Get emissions
        with torch.no_grad():
            emissions, _ = model(waveform)
        emission = emissions[0]  # [frames, tokens]
        
        logger.info(f"MMS alignment: {len(romanized_words)} words, {emission.shape[0]} frames")
        
        # Align
        token_spans = aligner(emission, tokenized)
        
        # Convert frame indices to timestamps
        # MMS_FA downsamples by 320x: 16000Hz → 50fps → 20ms per frame
        frame_ms = 20.0
        
        result = []
        for i, spans in enumerate(token_spans):
            if not spans:
                continue
            first = spans[0]
            last = spans[-1]
            w_start = first.start * frame_ms / 1000.0
            w_end = (last.end + 1) * frame_ms / 1000.0
            result.append(WordTiming(
                word=original_words[i],
                start=round(w_start, 3),
                end=round(w_end, 3),
            ))
        
        logger.info(f"MMS aligned {len(result)} words")
        return result
        
    except Exception as e:
        logger.error(f"MMS alignment failed: {e}", exc_info=True)
        return []


def align_lyrics_with_mms(
    audio_path: str,
    whisper_words: list[dict],
    lyrics_text: str,
    audio_start: float = 0.0,
    fragment_duration: float = 0.0,
    bpm: float = 0.0,
    beats: list[float] | None = None,
) -> tuple[list[WordTiming], str]:
    """
    Full pipeline: MMS forced alignment for precise word timestamps.
    
    Strategy:
    1. If user provided lyrics → align lyrics directly to audio with MMS
    2. If no lyrics → align whisper's words with MMS
    3. Map result to user lyrics via DTW if needed
    
    This replaces the old DTW/proportional fallback with actual phoneme-level alignment.
    """
    from services.forced_alignment import (
        _tokenize_lyrics, _normalize_word, _dtw_align, _bpm_aware_distribute,
        align_lyrics_to_timings,
    )
    
    if lyrics_text.strip():
        # User provided lyrics — align directly to audio
        user_words = _tokenize_lyrics(lyrics_text)
        if not user_words:
            return [], lyrics_text
        
        logger.info(f"MMS aligning user lyrics: {len(user_words)} words")
        mms_words = align_with_mms(audio_path, user_words)
        
        if mms_words and len(mms_words) >= len(user_words) * 0.5:
            # MMS gave good results
            logger.info(f"MMS successful: {len(mms_words)}/{len(user_words)} words aligned")
            
            # Adjust for audio_start offset
            if audio_start > 0:
                adjusted = []
                for w in mms_words:
                    adj_start = w.start - audio_start
                    adj_end = w.end - audio_start
                    if adj_end > 0:
                        adjusted.append(WordTiming(
                            word=w.word,
                            start=round(max(0, adj_start), 3),
                            end=round(adj_end, 3),
                        ))
                mms_words = adjusted
            
            return mms_words, lyrics_text
        else:
            logger.warning(f"MMS insufficient: {len(mms_words) if mms_words else 0}/{len(user_words)}, trying whisper alignment")
    
    # Fallback: use whisper + DTW
    if whisper_words:
        words = align_lyrics_to_timings(lyrics_text, whisper_words)
        
        # Check coverage
        if fragment_duration > 0 and words:
            whisper_end = whisper_words[-1]["end"] if whisper_words else 0
            whisper_coverage = whisper_end / fragment_duration if fragment_duration > 0 else 0
            
            if whisper_coverage < 0.5:
                user_word_list = _tokenize_lyrics(lyrics_text)
                words = _bpm_aware_distribute(
                    user_word_list, fragment_duration, bpm=bpm, beats=beats
                )
        
        # Adjust for audio_start
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
    
    # Last resort: BPM distribution
    logger.warning("All alignment methods failed, using BPM distribution")
    user_word_list = _tokenize_lyrics(lyrics_text)
    words = _bpm_aware_distribute(user_word_list, fragment_duration, bpm=bpm, beats=beats)
    return words, lyrics_text