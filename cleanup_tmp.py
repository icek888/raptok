#!/usr/bin/env python3
"""Clean temporary files older than 24h from RapTok tmp dirs."""
import os, time, subprocess

cutoff = time.time() - 86400  # 24 hours

# --- Host cleanup ---
host_dir = "/home/karlen/project/raptok/tmp/"
host_deleted = 0

if os.path.isdir(host_dir):
    for root, dirs, files in os.walk(host_dir):
        for f in files:
            fp = os.path.join(root, f)
            try:
                if os.path.getmtime(fp) < cutoff:
                    os.remove(fp)
                    host_deleted += 1
            except Exception:
                pass

print(f"HOST: deleted {host_deleted} files from {host_dir}")

# --- Container cleanup ---
container_deleted = "N/A"
try:
    r = subprocess.run(
        ["docker", "exec", "raptok-raptok-backend-1", "python3", "-c",
         "import os,time;d='/tmp/raptok/';c=time.time()-86400;n=0;\n"
         "exec('for root,dirs,files in os.walk(d):\\n"
         " for f in files:\\n"
         "  fp=os.path.join(root,f)\\n"
         "  try:\\n"
         "   if os.path.getmtime(fp)<c:os.remove(fp);n+=1\\n"
         "  except:pass')\n"
         "if not os.path.isdir(d):n=0\n"
         "print(n)"],
        capture_output=True, text=True, timeout=30
    )
    container_deleted = r.stdout.strip()
    if r.returncode != 0 and r.stderr:
        print(f"CONTAINER_ERROR: {r.stderr.strip()}")
except Exception as e:
    print(f"CONTAINER_ERROR: {e}")

print(f"CONTAINER: deleted {container_deleted} files from /tmp/raptok/")