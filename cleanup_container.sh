#!/bin/sh
CUTOFF=$(date +%s)
CUTOFF=$((CUTOFF - 86400))
cd /tmp/raptok
count=0
for f in *; do
  if [ -f "$f" ]; then
    m=$(stat -c %Y "$f" 2>/dev/null)
    if [ -n "$m" ] && [ "$m" -lt "$CUTOFF" ]; then
      rm -f "$f"
      count=$((count + 1))
    fi
  fi
done
echo "removed $count files"
echo "remaining: $(ls | wc -l)"
du -sh .