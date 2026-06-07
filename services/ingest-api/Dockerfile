FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install the workspace-shared tracebility-tenant package first. uv treats
# it as a workspace member; pip needs it pre-installed locally so the
# subsequent ``pip install .`` finds it (the package is not published to
# PyPI).
COPY services/_shared/tenant /tmp/tracebility-tenant
RUN pip install --no-cache-dir /tmp/tracebility-tenant && rm -rf /tmp/tracebility-tenant

COPY services/ingest-api/pyproject.toml ./pyproject.toml
COPY services/ingest-api/tracebility_ingest ./tracebility_ingest

RUN pip install --no-cache-dir .

EXPOSE 7080
CMD ["python", "-m", "tracebility_ingest"]
