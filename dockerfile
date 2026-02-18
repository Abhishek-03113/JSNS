# ---------------------------------------------------------------
# Multi-stage Dockerfile for ATS-Buddy Career Scraper
# ---------------------------------------------------------------

# Stage 1: Build — install all Python deps
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# Stage 2: Runtime — lean image
FROM python:3.11-slim AS runtime

LABEL maintainer="ATS-Buddy"
LABEL description="Automated career-page scraper with LLM resume matching"

WORKDIR /app

COPY --from=builder /install /usr/local

COPY src/       src/
COPY config.yaml .

RUN useradd --create-home appuser
USER appuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD python -c "from src.config.settings import load_settings; print('ok')"

ENTRYPOINT ["python", "src/main.py"]
