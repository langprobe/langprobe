"""CLI entrypoint: ``python -m langprobe_api``."""

from __future__ import annotations

import uvicorn

from . import config


def main() -> None:
    settings = config.load()
    uvicorn.run(
        "langprobe_api.app:app",
        host=settings.bind_host,
        port=settings.bind_port,
        log_config=None,
    )


if __name__ == "__main__":
    main()
