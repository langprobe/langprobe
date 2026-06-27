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

COPY services/api/pyproject.toml ./pyproject.toml
COPY services/api/langprobe_api ./langprobe_api

RUN pip install --no-cache-dir . \
 && pip install --no-cache-dir --force-reinstall --no-deps "uvicorn[standard]>=0.27"

EXPOSE 7081
CMD ["python", "-m", "langprobe_api"]
