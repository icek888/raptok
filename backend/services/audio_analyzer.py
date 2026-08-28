"""
Deep audio analysis for RapTok — mood, energy, genre, hook detection.
Uses librosa spectral features + key detection + energy profiling.
All CPU-based, no GPU needed.
"""
import numpy as np
import librosa
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def analyze_track(audio_path: str) -> dict:
    """
    Full track analysis: mood, energy profile, genre hint, hook detection.
    
    Returns:
        {
            "duration": float,
            "bpm": float,
            "key": str,           # e.g. "C minor"
            "key_confidence": float,
            "mood": str,          # e.g. "Energetic", "Dark", "Chill"
            "mood_emoji": str,    # e.g. "🟢"
            "mood_scores": {      # 0-1 scores
                "energy": float,
                "valence": float,  # happy/sad
                "aggressiveness": float,
                "brightness": float,
                "danceability": float,
            },
            "energy_profile": [   # segmented energy over time
                {"start": float, "end": float, "energy": float, "label": str}
            ],
            "energy_curve": [float],  # raw energy samples (downsampled)
            "energy_times": [float],  # timestamps for energy_curve
            "hook_time": float,       # best moment for short clip (Reels/TikTok)
            "hook_score": float,      # 0-1 confidence
            "genre_hint": str,        # e.g. "Hip-Hop", "Pop", "Electronic"
            "spectral_features": {
                "centroid": float,
                "rolloff": float,
                "zcr": float,
                "bass_ratio": float,
                "contrast_mean": float,
            },
            "sections": [            # song structure
                {"start": float, "end": float, "label": str, "energy": float}
            ],
        }
    """
    try:
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        
        hop = 512
        
        # ─── 1. Spectral features ───
        # Spectral centroid (brightness)
        centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop)[0]
        centroid_mean = float(np.mean(centroid))
        
        # Spectral rolloff (high-freq content)
        rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=hop, roll_percent=0.85)[0]
        rolloff_mean = float(np.mean(rolloff))
        
        # Zero crossing rate (percussiveness/aggression)
        zcr = librosa.feature.zero_crossing_rate(y, hop_length=hop)[0]
        zcr_mean = float(np.mean(zcr))
        
        # Spectral contrast (tonal vs noisy)
        contrast = librosa.feature.spectral_contrast(y=y, sr=sr, hop_length=hop)
        contrast_mean = float(np.mean(contrast))
        
        # Bass ratio (low-frequency energy)
        bass_energy = float(np.mean(contrast[0]))  # lowest band
        treble_energy = float(np.mean(contrast[-1]))  # highest band
        bass_ratio = bass_energy / (bass_energy + treble_energy + 1e-10)
        
        # ─── 2. Key detection (major/minor) ───
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
        chroma_mean = np.mean(chroma, axis=1)
        
        # Krumhansl-Schmuckler key profiles
        major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        
        key_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        
        best_score = -1
        best_key_idx = 0
        best_is_minor = False
        
        for i in range(12):
            # Rotate chroma to test each key
            rotated = np.roll(chroma_mean, -i)
            major_corr = np.corrcoef(rotated, major_profile)[0, 1]
            minor_corr = np.corrcoef(rotated, minor_profile)[0, 1]
            
            if major_corr > best_score:
                best_score = major_corr
                best_key_idx = i
                best_is_minor = False
            if minor_corr > best_score:
                best_score = minor_corr
                best_key_idx = i
                best_is_minor = True
        
        key_name = key_names[best_key_idx] + (' minor' if best_is_minor else ' major')
        key_confidence = float(best_score)
        
        # ─── 3. Energy (RMS) ───
        rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
        rms_norm = rms / (np.max(rms) + 1e-10)
        rms_mean = float(np.mean(rms_norm))
        rms_std = float(np.std(rms_norm))
        
        # ─── 4. Mood scores (0-1) ───
        # Normalize spectral centroid (0-1) — typical range 500-5000 Hz
        brightness = np.clip((centroid_mean - 500) / 3500, 0, 1)
        
        # Energy score from RMS + tempo
        tempo_raw = librosa.feature.tempo(y=y, sr=sr)[0]
        tempo_norm = np.clip(tempo_raw / 200, 0, 1)
        energy_score = np.clip(rms_mean * 0.6 + tempo_norm * 0.4, 0, 1)
        
        # Valence (happy/sad) — major key + brightness = happy
        valence = np.clip(
            (0.5 if not best_is_minor else 0.2) + brightness * 0.3 + (1 - rms_std) * 0.2,
            0, 1
        )
        
        # Aggressiveness — high ZCR + high bass + high contrast
        zcr_norm = np.clip(zcr_mean / 0.15, 0, 1)
        aggressiveness = np.clip(zcr_norm * 0.4 + bass_ratio * 0.3 + energy_score * 0.3, 0, 1)
        
        # Danceability — tempo + regularity of beats + bass
        onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
        onset_reg = 1.0 - np.std(np.diff(librosa.frames_to_time(np.where(onset_env > onset_env.mean())[0], sr=sr, hop_length=hop) + 1e-10)) if np.any(onset_env > onset_env.mean()) else 0.5
        danceability = np.clip(tempo_norm * 0.3 + bass_ratio * 0.3 + onset_reg * 0.4, 0, 1)
        
        # ─── 5. Mood classification ───
        moods = classify_mood(energy_score, valence, aggressiveness, brightness, best_is_minor, tempo_raw)
        
        # ─── 6. Energy profile (segmented) ───
        energy_profile, energy_curve, energy_times = build_energy_profile(rms_norm, sr, hop, duration)
        
        # ─── 7. Hook detection (peak energy moment) ───
        hook_time, hook_score = find_hook(rms_norm, sr, hop, duration, energy_profile)
        
        # ─── 8. Genre hint ───
        genre_hint = guess_genre(tempo_raw, bass_ratio, zcr_mean, centroid_mean, best_is_minor, energy_score)
        
        # ─── 9. Song sections ───
        sections = detect_sections(rms_norm, sr, hop, duration, bpm=tempo_raw)
        
        # Downsample energy curve for frontend
        step = max(1, len(rms_norm) // 200)
        energy_curve = [round(float(v), 4) for v in rms_norm[::step]]
        energy_times = [round(float(t), 3) for t in librosa.frames_to_time(
            range(0, len(rms_norm), step), sr=sr, hop_length=hop
        )]
        
        return {
            "duration": round(duration, 2),
            "bpm": round(float(tempo_raw), 1),
            "key": key_name,
            "key_confidence": round(key_confidence, 3),
            "mood": moods["label"],
            "mood_emoji": moods["emoji"],
            "mood_color": moods["color"],
            "mood_description": moods["description"],
            "mood_scores": {
                "energy": round(energy_score, 3),
                "valence": round(valence, 3),
                "aggressiveness": round(aggressiveness, 3),
                "brightness": round(brightness, 3),
                "danceability": round(danceability, 3),
            },
            "energy_profile": energy_profile,
            "energy_curve": energy_curve,
            "energy_times": energy_times,
            "hook_time": round(hook_time, 2),
            "hook_score": round(hook_score, 3),
            "genre_hint": genre_hint,
            "spectral_features": {
                "centroid": round(centroid_mean, 1),
                "rolloff": round(rolloff_mean, 1),
                "zcr": round(zcr_mean, 4),
                "bass_ratio": round(bass_ratio, 3),
                "contrast_mean": round(contrast_mean, 3),
            },
            "sections": sections,
        }
        
    except Exception as e:
        logger.error(f"Track analysis failed: {e}")
        raise


def classify_mood(energy: float, valence: float, aggressiveness: float, 
                  brightness: float, is_minor: bool, tempo: float) -> dict:
    """Classify mood from audio features."""
    
    # High energy + high aggressiveness + minor = Dark/Hype
    if energy > 0.6 and aggressiveness > 0.5 and is_minor:
        return {
            "label": "Dark Hype",
            "emoji": "🔴",
            "color": "#ef4444",
            "description": "Тёмный, агрессивный, энергичный трек. Идеально для hard rap/trap.",
        }
    
    # High energy + high valence = Happy/Upbeat
    if energy > 0.5 and valence > 0.6:
        return {
            "label": "Upbeat",
            "emoji": "🟡",
            "color": "#facc15",
            "description": "Яркий, позитивный, энергичный. Поп/дэнс вибрации.",
        }
    
    # High energy + low valence = Energetic/Intense
    if energy > 0.5 and valence < 0.4:
        return {
            "label": "Intense",
            "emoji": "🟠",
            "color": "#f97316",
            "description": "Напряжённый, драйвовый. Хип-хоп/рок энергетика.",
        }
    
    # High energy general
    if energy > 0.5:
        return {
            "label": "Energetic",
            "emoji": "🟢",
            "color": "#22c55e",
            "description": "Энергичный трек с хорошим драйвом. Универсальный для TikTok.",
        }
    
    # Low energy + low valence = Melancholic/Sad
    if energy < 0.35 and valence < 0.4:
        return {
            "label": "Melancholic",
            "emoji": "🟣",
            "color": "#a855f7",
            "description": "Грустный, меланхоличный. Лиричный вайб.",
        }
    
    # Low energy + high valence = Chill
    if energy < 0.35 and valence > 0.5:
        return {
            "label": "Chill",
            "emoji": "🔵",
            "color": "#3b82f6",
            "description": "Расслабленный, спокойный. Lo-fi/chill vibes.",
        }
    
    # Default
    if is_minor:
        return {
            "label": "Moody",
            "emoji": "🟣",
            "color": "#8b5cf6",
            "description": "Атмосферный, эмоциональный трек.",
        }
    
    return {
        "label": "Balanced",
        "emoji": "⚪",
        "color": "#6b7280",
        "description": "Сбалансированный трек. Средняя энергия и настроение.",
    }


def build_energy_profile(rms_norm: np.ndarray, sr: int, hop: int, duration: float) -> tuple:
    """Segment track into energy zones."""
    # Segment size: ~5 seconds
    seg_samples = int(5 * sr / hop)
    n_segs = max(1, len(rms_norm) // seg_samples)
    
    profile = []
    for i in range(n_segs):
        start_sample = i * seg_samples
        end_sample = min((i + 1) * seg_samples, len(rms_norm))
        seg_energy = float(np.mean(rms_norm[start_sample:end_sample]))
        
        start_t = (start_sample * hop) / sr
        end_t = min((end_sample * hop) / sr, duration)
        
        # Label by energy level
        if seg_energy > 0.6:
            label = "peak"
        elif seg_energy > 0.35:
            label = "high"
        elif seg_energy > 0.15:
            label = "mid"
        else:
            label = "low"
        
        profile.append({
            "start": round(start_t, 2),
            "end": round(end_t, 2),
            "energy": round(seg_energy, 3),
            "label": label,
        })
    
    return profile, [], []


def find_hook(rms_norm: np.ndarray, sr: int, hop: int, duration: float, 
              energy_profile: list) -> tuple:
    """Find the best hook moment — peak energy section, preferably with a drop."""
    if not energy_profile:
        return 0.0, 0.0
    
    # Find the peak segment
    best_seg = max(energy_profile, key=lambda s: s["energy"])
    
    # Hook time = center of peak segment
    hook_time = (best_seg["start"] + best_seg["end"]) / 2
    
    # Score based on how much louder the peak is vs average
    avg_energy = np.mean([s["energy"] for s in energy_profile])
    hook_score = min(1.0, best_seg["energy"] / (avg_energy + 0.01))
    
    # Look for a "drop" — sharp energy increase
    for i in range(1, len(energy_profile)):
        prev_e = energy_profile[i - 1]["energy"]
        curr_e = energy_profile[i]["energy"]
        if curr_e - prev_e > 0.3:  # sharp rise = drop
            hook_time = energy_profile[i]["start"]
            hook_score = min(1.0, hook_score + 0.2)
            break
    
    return hook_time, hook_score


def guess_genre(tempo: float, bass_ratio: float, zcr: float, centroid: float,
                is_minor: bool, energy: float) -> str:
    """Guess genre from audio features (heuristic)."""
    
    # Hip-Hop/Rap: moderate tempo, high bass, moderate ZCR
    if 70 <= tempo <= 110 and bass_ratio > 0.55 and zcr > 0.05:
        return "Hip-Hop/Rap"
    
    # Trap: higher tempo or half-time feel, very high bass, dark
    if (130 <= tempo <= 160 or 65 <= tempo <= 85) and bass_ratio > 0.6 and is_minor:
        return "Trap"
    
    # Electronic/EDM: high tempo, high centroid, high energy
    if tempo > 120 and centroid > 2500 and energy > 0.5:
        return "Electronic"
    
    # Pop: moderate-high tempo, bright, major
    if tempo > 100 and centroid > 2000 and not is_minor:
        return "Pop"
    
    # Rock: high ZCR, high energy, moderate tempo
    if zcr > 0.09 and energy > 0.5:
        return "Rock"
    
    # R&B/Soul: slow-mid tempo, smooth, bass
    if 60 <= tempo <= 100 and bass_ratio > 0.5 and energy < 0.5:
        return "R&B"
    
    # Lo-Fi: slow, low energy, low centroid
    if tempo < 90 and energy < 0.3 and centroid < 1800:
        return "Lo-Fi"
    
    return "Mixed"


def detect_sections(rms_norm: np.ndarray, sr: int, hop: int, duration: float,
                    bpm: float = 120) -> list:
    """Detect song sections (intro, verse, chorus, etc.) based on energy changes."""
    if duration < 10:
        return [{"start": 0, "end": round(duration, 2), "label": "full", "energy": float(np.mean(rms_norm))}]
    
    # Use ~8 bar segments
    bar_duration = (60 / bpm) * 4 if bpm > 0 else 8
    seg_duration = max(8, bar_duration * 4)  # ~4 bars
    seg_samples = int(seg_duration * sr / hop)
    n_segs = max(1, len(rms_norm) // seg_samples)
    
    segments = []
    for i in range(n_segs):
        start_sample = i * seg_samples
        end_sample = min((i + 1) * seg_samples, len(rms_norm))
        seg_energy = float(np.mean(rms_norm[start_sample:end_sample]))
        
        start_t = (start_sample * hop) / sr
        end_t = min((end_sample * hop) / sr, duration)
        
        segments.append({
            "start": round(start_t, 2),
            "end": round(end_t, 2),
            "energy": round(seg_energy, 3),
        })
    
    # Label sections based on position and energy
    n = len(segments)
    avg_energy = np.mean([s["energy"] for s in segments])
    
    for i, seg in enumerate(segments):
        if i == 0 and seg["energy"] < avg_energy * 0.7:
            seg["label"] = "intro"
        elif i == n - 1 and seg["energy"] < avg_energy * 0.7:
            seg["label"] = "outro"
        elif seg["energy"] > avg_energy * 1.3:
            seg["label"] = "chorus"
        elif seg["energy"] > avg_energy * 1.1:
            seg["label"] = "hook"
        elif seg["energy"] < avg_energy * 0.6:
            seg["label"] = "break"
        else:
            seg["label"] = "verse"
    
    return segments