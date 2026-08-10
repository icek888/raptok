"""RapTok backend configuration."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMP_DIR = Path(os.getenv("RAPTOK_TEMP_DIR", BASE_DIR / "tmp"))
OUTPUT_DIR = Path(os.getenv("RAPTOK_OUTPUT_DIR", BASE_DIR / "output"))

TEMP_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ffmpeg settings
FFMPEG_PRESET = os.getenv("RAPTOK_FFMPEG_PRESET", "fast")
FFMPEG_CRF = int(os.getenv("RAPTOK_FFMPEG_CRF", "22"))

# Output format
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
OUTPUT_FPS = 30

# Fragment defaults
MIN_FRAGMENT_DURATION = 3.0
MAX_FRAGMENT_DURATION = 5.0
MIN_TOTAL_DURATION = 21.0
MAX_TOTAL_DURATION = 30.0
DEFAULT_FRAGMENT_COUNT = 7