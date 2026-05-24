FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY services/api/pyproject.toml ./pyproject.toml
COPY services/api/tracebility_api ./tracebility_api

RUN pip install --no-cache-dir .

EXPOSE 7081
CMD ["python", "-m", "tracebility_api"]
