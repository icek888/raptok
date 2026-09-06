#!/bin/bash
set -e

# Always pull the latest yt-dlp before starting.
# YouTube changes its player clients / PO-token requirements frequently;
# a stale yt-dlp is the #1 cause of "HTTP Error 403: Forbidden".
echo "[entrypoint] Updating yt-dlp to latest..."
pip install --quiet -U yt-dlp
echo "[entrypoint] yt-dlp $(yt-dlp --version)"

# Ensure whisperx is present. It's a heavy dep (torch + transformers).
# site-packages is mounted as a persistent volume (whisperx-store), so a
# `docker compose create --force-recreate` does NOT wipe it — whisperx
# survives recreates. This check is just a safety net.
if ! python3 -c "import whisperx" 2>/dev/null; then
    echo "[entrypoint] whisperx missing — installing (pip cache from volume speeds this up)..."
    pip install --quiet whisperx
    echo "[entrypoint] whisperx installed"
else
    echo "[entrypoint] whisperx present ✓"
fi

exec uvicorn main:app --host 0.0.0.0 --port 8000
