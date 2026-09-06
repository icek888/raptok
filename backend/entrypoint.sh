#!/bin/bash
set -e

# Always pull the latest yt-dlp before starting.
# YouTube changes its player clients / PO-token requirements frequently;
# a stale yt-dlp is the #1 cause of "HTTP Error 403: Forbidden".
echo "[entrypoint] Updating yt-dlp to latest..."
pip install --quiet --no-cache-dir -U yt-dlp
echo "[entrypoint] yt-dlp $(yt-dlp --version)"

# Ensure whisperx is present. It's a heavy dep (torch + transformers) and was
# historically installed by hand into the running container — which a
# `docker compose create --force-recreate` wipes. Guard against that: install
# only if missing, so a normal restart stays fast.
if ! python3 -c "import whisperx" 2>/dev/null; then
    echo "[entrypoint] whisperx missing — installing (this may take a few minutes)..."
    pip install --quiet --no-cache-dir whisperx
    echo "[entrypoint] whisperx installed"
else
    echo "[entrypoint] whisperx present"
fi

exec uvicorn main:app --host 0.0.0.0 --port 8000
