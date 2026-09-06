#!/bin/bash
set -e

# Always pull the latest yt-dlp before starting.
# YouTube changes its player clients / PO-token requirements frequently;
# a stale yt-dlp is the #1 cause of "HTTP Error 403: Forbidden".
# This keeps the extractor fresh on every container start without a full image rebuild.
echo "[entrypoint] Updating yt-dlp to latest..."
pip install --quiet --no-cache-dir -U yt-dlp
echo "[entrypoint] yt-dlp $(yt-dlp --version)"

exec uvicorn main:app --host 0.0.0.0 --port 8000
