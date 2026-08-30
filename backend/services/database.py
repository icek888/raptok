"""
SQLite database for RapTok — projects, renders, presets, user settings.

Uses Python's built-in sqlite3 — no extra dependencies.
Database file: /tmp/raptok/raptok.db
"""
import sqlite3
import json
import time
import logging
from pathlib import Path
from typing import Optional
from config import TEMP_DIR

logger = logging.getLogger(__name__)

DB_PATH = TEMP_DIR / "raptok.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    name TEXT NOT NULL,
    video_url TEXT,
    video_path TEXT,
    audio_path TEXT,
    audio_name TEXT,
    lyrics TEXT,
    fragments_json TEXT,
    subtitles_json TEXT,
    word_timings_json TEXT,
    style_json TEXT,
    template_id TEXT,
    display_mode TEXT,
    karaoke INTEGER DEFAULT 1,
    audio_start REAL DEFAULT 0,
    beat_effects_json TEXT,
    status TEXT DEFAULT 'draft',
    created_at REAL,
    updated_at REAL
);

CREATE TABLE IF NOT EXISTS renders (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    user TEXT NOT NULL,
    filename TEXT NOT NULL,
    output_path TEXT NOT NULL,
    duration REAL,
    resolution TEXT,
    file_size INTEGER,
    created_at REAL,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    name TEXT NOT NULL,
    style_json TEXT NOT NULL,
    template_id TEXT,
    created_at REAL
);

CREATE TABLE IF NOT EXISTS user_settings (
    user TEXT PRIMARY KEY,
    whisper_model TEXT DEFAULT 'small',
    default_template TEXT,
    default_style_json TEXT,
    render_quality TEXT DEFAULT '1080p',
    created_at REAL,
    updated_at REAL
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user);
CREATE INDEX IF NOT EXISTS idx_renders_user ON renders(user);
CREATE INDEX IF NOT EXISTS idx_renders_project ON renders(project_id);
CREATE INDEX IF NOT EXISTS idx_presets_user ON presets(user);
"""

def _get_db() -> sqlite3.Connection:
    """Get a SQLite connection with Row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize database — create tables if not exist."""
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = _get_db()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()
        logger.info(f"SQLite initialized: {DB_PATH}")
    except Exception as e:
        logger.error(f"SQLite init failed: {e}")


def _gen_id(prefix: str = "") -> str:
    """Generate a short unique ID."""
    import os
    return f"{prefix}{os.urandom(8).hex()}"


# ── Projects ──

def create_project(user: str, name: str = "Untitled") -> dict:
    """Create a new project."""
    pid = _gen_id("proj_")
    now = time.time()
    conn = _get_db()
    conn.execute(
        "INSERT INTO projects (id, user, name, status, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?)",
        (pid, user, name, now, now)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return dict(row)


def save_project(
    user: str,
    project_id: str,
    data: dict,
) -> dict:
    """Update project with full state data."""
    now = time.time()
    conn = _get_db()

    # Check ownership
    row = conn.execute("SELECT * FROM projects WHERE id = ? AND user = ?", (project_id, user)).fetchone()
    if not row:
        conn.close()
        return {}

    fields = []
    values = []
    for key, val in data.items():
        if key in ("fragments", "subtitles", "word_timings", "style", "beat_effects"):
            col = f"{key}_json"
            fields.append(f"{col} = ?")
            values.append(json.dumps(val))
        elif key in ("video_url", "video_path", "audio_path", "audio_name", "lyrics",
                      "template_id", "display_mode", "karaoke", "audio_start", "name", "status"):
            fields.append(f"{key} = ?")
            values.append(val)

    if not fields:
        conn.close()
        return dict(row)

    fields.append("updated_at = ?")
    values.append(now)
    values.append(project_id)
    values.append(user)

    conn.execute(
        f"UPDATE projects SET {', '.join(fields)} WHERE id = ? AND user = ?",
        values
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return dict(row) if row else {}


def get_project(user: str, project_id: str) -> dict | None:
    """Get a project by ID (with ownership check)."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ? AND user = ?", (project_id, user)).fetchone()
    conn.close()
    if not row:
        return None
    result = dict(row)
    # Parse JSON fields
    for key in ("fragments", "subtitles", "word_timings", "style", "beat_effects"):
        col = f"{key}_json"
        if result.get(col):
            result[key] = json.loads(result[col])
        else:
            result[key] = [] if key != "style" and key != "beat_effects" else {}
    return result


def list_projects(user: str, limit: int = 50) -> list[dict]:
    """List all projects for a user, newest first."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT id, name, status, video_url, audio_name, created_at, updated_at FROM projects WHERE user = ? ORDER BY updated_at DESC LIMIT ?",
        (user, limit)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_project(user: str, project_id: str) -> bool:
    """Delete a project and its renders."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ? AND user = ?", (project_id, user)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("DELETE FROM renders WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return True


# ── Renders ──

def save_render(user: str, filename: str, output_path: str, project_id: str | None = None,
                duration: float = 0, resolution: str = "1080x1920", file_size: int = 0) -> dict:
    """Save a render record."""
    rid = _gen_id("rend_")
    now = time.time()
    conn = _get_db()
    conn.execute(
        "INSERT INTO renders (id, project_id, user, filename, output_path, duration, resolution, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (rid, project_id, user, filename, output_path, duration, resolution, file_size, now)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM renders WHERE id = ?", (rid,)).fetchone()
    conn.close()
    return dict(row)


def list_renders(user: str, limit: int = 30) -> list[dict]:
    """List all renders for a user, newest first."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM renders WHERE user = ? ORDER BY created_at DESC LIMIT ?",
        (user, limit)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_render(user: str, render_id: str) -> bool:
    """Delete a render record."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM renders WHERE id = ? AND user = ?", (render_id, user)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("DELETE FROM renders WHERE id = ?", (render_id,))
    conn.commit()
    conn.close()
    return True


# ── Presets ──

def save_preset(user: str, name: str, style_json: str, template_id: str | None = None) -> dict:
    """Save a style preset."""
    pid = _gen_id("preset_")
    now = time.time()
    conn = _get_db()
    conn.execute(
        "INSERT INTO presets (id, user, name, style_json, template_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (pid, user, name, style_json, template_id, now)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM presets WHERE id = ?", (pid,)).fetchone()
    conn.close()
    return dict(row)


def list_presets(user: str) -> list[dict]:
    """List all presets for a user."""
    conn = _get_db()
    rows = conn.execute("SELECT * FROM presets WHERE user = ? ORDER BY created_at DESC", (user,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_preset(user: str, preset_id: str) -> bool:
    """Delete a preset."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM presets WHERE id = ? AND user = ?", (preset_id, user)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("DELETE FROM presets WHERE id = ?", (preset_id,))
    conn.commit()
    conn.close()
    return True


# ── User Settings ──

def get_settings(user: str) -> dict:
    """Get user settings, create defaults if not exist."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM user_settings WHERE user = ?", (user,)).fetchone()
    if not row:
        now = time.time()
        conn.execute(
            "INSERT INTO user_settings (user, created_at, updated_at) VALUES (?, ?, ?)",
            (user, now, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM user_settings WHERE user = ?", (user,)).fetchone()
    conn.close()
    return dict(row) if row else {}


def update_settings(user: str, settings: dict) -> dict:
    """Update user settings."""
    now = time.time()
    conn = _get_db()
    row = conn.execute("SELECT * FROM user_settings WHERE user = ?", (user,)).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO user_settings (user, created_at, updated_at) VALUES (?, ?, ?)",
            (user, now, now)
        )
        conn.commit()

    fields = []
    values = []
    for key in ("whisper_model", "default_template", "default_style_json", "render_quality"):
        if key in settings:
            fields.append(f"{key} = ?")
            values.append(settings[key])

    if fields:
        fields.append("updated_at = ?")
        values.append(now)
        values.append(user)
        conn.execute(f"UPDATE user_settings SET {', '.join(fields)} WHERE user = ?", values)
        conn.commit()

    row = conn.execute("SELECT * FROM user_settings WHERE user = ?", (user,)).fetchone()
    conn.close()
    return dict(row) if row else {}


# ── Stats ──

def get_stats(user: str) -> dict:
    """Get user statistics."""
    conn = _get_db()
    projects = conn.execute("SELECT COUNT(*) as c FROM projects WHERE user = ?", (user,)).fetchone()
    renders = conn.execute("SELECT COUNT(*) as c FROM renders WHERE user = ?", (user,)).fetchone()
    presets = conn.execute("SELECT COUNT(*) as c FROM presets WHERE user = ?", (user,)).fetchone()
    # Total render duration
    total_dur = conn.execute("SELECT SUM(duration) as s FROM renders WHERE user = ?", (user,)).fetchone()
    conn.close()
    return {
        "projects": projects["c"] if projects else 0,
        "renders": renders["c"] if renders else 0,
        "presets": presets["c"] if presets else 0,
        "total_render_duration": total_dur["s"] if total_dur and total_dur["s"] else 0,
    }