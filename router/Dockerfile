# syntax=docker/dockerfile:1
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY shared/py /build/shared/py
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir /build/shared/py

COPY router /build/router
RUN pip install --no-cache-dir /build/router

FROM python:3.12-slim AS runner

WORKDIR /app

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY router/src /app/src

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

CMD ["python", "-m", "src.main"]
