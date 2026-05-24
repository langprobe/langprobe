FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY services/ingest-worker/pyproject.toml ./pyproject.toml
COPY services/ingest-worker/tracebility_worker ./tracebility_worker

RUN pip install --no-cache-dir .

CMD ["python", "-m", "tracebility_worker"]
