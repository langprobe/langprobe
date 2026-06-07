FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install the workspace-shared tracebility-tenant package first. uv treats
# it as a workspace member; pip needs it pre-installed locally so the
# subsequent ``pip install .`` finds it (not published to PyPI).
COPY services/_shared/tenant /tmp/tracebility-tenant
RUN pip install --no-cache-dir /tmp/tracebility-tenant && rm -rf /tmp/tracebility-tenant

COPY services/ingest-worker/pyproject.toml ./pyproject.toml
COPY services/ingest-worker/tracebility_worker ./tracebility_worker

RUN pip install --no-cache-dir .

CMD ["python", "-m", "tracebility_worker"]
