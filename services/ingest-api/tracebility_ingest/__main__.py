"""CLI entrypoint: ``python -m tracebility_ingest``.

Reads bind host/port from config so the same artifact runs in dev (bind 127.0.0.1)
and prod (bind 0.0.0.0) without a code change.
"""

from __future__ import annotations

import uvicorn

from . import config


def main() -> None:
    settings = config.load()
    uvicorn.run(
        "tracebility_ingest.app:app",
        host=settings.bind_host,
        port=settings.bind_port,
        log_config=None,
    )


if __name__ == "__main__":
    main()
