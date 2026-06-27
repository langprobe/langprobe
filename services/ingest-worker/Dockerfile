FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install the workspace-shared langprobe-tenant package first. uv treats
# it as a workspace member; pip needs it pre-installed locally so the
# subsequent ``pip install .`` finds it (not published to PyPI).
COPY services/_shared/tenant /tmp/langprobe-tenant
RUN pip install --no-cache-dir /tmp/langprobe-tenant && rm -rf /tmp/langprobe-tenant

COPY services/ingest-worker/pyproject.toml ./pyproject.toml
COPY services/ingest-worker/langprobe_worker ./langprobe_worker

RUN pip install --no-cache-dir .

CMD ["python", "-m", "langprobe_worker"]
