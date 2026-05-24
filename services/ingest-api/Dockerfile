FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY services/ingest-api/pyproject.toml ./pyproject.toml
COPY services/ingest-api/tracebility_ingest ./tracebility_ingest

RUN pip install --no-cache-dir .

EXPOSE 7080
CMD ["python", "-m", "tracebility_ingest"]
