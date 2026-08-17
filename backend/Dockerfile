FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libgomp1 \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install deno for yt-dlp YouTube extraction
RUN curl -fsSL https://deno.land/install.sh | sh && \
    ln -s /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install CPU-only torch + torchaudio (for MMS forced alignment)
RUN pip install --no-cache-dir torch==2.13.0+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torchaudio==2.11.0+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir transformers soundfile

# Install audio-separator (vocal stem separation, CPU-only)
RUN pip install --no-cache-dir audio-separator --no-deps
RUN pip install --no-cache-dir \
    beartype>=0.18.5 einops>=0.7 julius>=0.2 ml_collections \
    pydub>=0.25 resampy>=0.4 rotary-embedding-torch>=0.6.1 \
    samplerate==0.1.0 onnx2torch-py313 diffq onnx-weekly
RUN pip install --no-cache-dir torchvision==0.28.0+cpu --index-url https://download.pytorch.org/whl/cpu

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]