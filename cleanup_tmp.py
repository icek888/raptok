#!/usr/bin/env python3
"""Clean temp files older than 24h from RapTok tmp dirs."""
import os, time, subprocess

cutoff = time.time() - 86400  # 24 hours ago
host_dir = "/home/karlen/project/raptok/tmp/"
results = {}

# --- Host tmp ---
cleaned_host = []
freed_host = 0
if os.path.isdir(host_dir):
    for root, dirs, files in os.walk(host_dir):
        for f in files:
            fp = os.path.join(root, f)
            try:
                mtime = os.path.getmtime(fp)
                if mtime < cutoff:
                    sz = os.path.getsize(fp)
                    os.remove(fp)
                    cleaned_host.append(fp)
                    freed_host += sz
            except Exception:
                pass
results['host'] = {'cleaned': len(cleaned_host), 'freed_mb': round(freed_host / 1048576, 1)}
print(f"Host tmp: removed {len(cleaned_host)} files, freed {freed_host/1048576:.1f} MB")

# --- Container tmp ---
container_cleaned = 0
try:
    # List files in container /tmp/raptok/ and check mtime via stat
    result = subprocess.run(
        ['docker', 'exec', 'raptok-raptok-backend-1', 'find', '/tmp/raptok/', '-type', 'f'],
        capture_output=True, text=True, timeout=30
    )
    container_files = result.stdout.strip().split('\n') if result.stdout.strip() else []
    
    for cf in container_files:
        if not cf:
            continue
        try:
            stat_res = subprocess.run(
                ['docker', 'exec', 'raptok-raptok-backend-1', 'stat', '-c', '%Y', cf],
                capture_output=True, text=True, timeout=5
            )
            if stat_res.returncode == 0:
                mtime = int(stat_res.stdout.strip())
                if mtime < cutoff:
                    subprocess.run(
                        ['docker', 'exec', 'raptok-raptok-backend-1', 'rm', '-f', cf],
                        capture_output=True, timeout=5
                    )
                    container_cleaned += 1
        except Exception:
            pass
except Exception as e:
    print(f"Container cleanup error: {e}")

results['container'] = {'cleaned': container_cleaned}
print(f"Container tmp: removed {container_cleaned} files")
print(f"\nSummary: {results}")