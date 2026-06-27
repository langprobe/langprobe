"""LangSmith → langprobe migration CLI.

Reads a LangSmith export (JSONL or a directory of JSONL files) and
replays the rows into a langprobe ingest host's LangSmith parity
endpoints. The ingest-api side does the real translation; this CLI's
job is just to stream rows over the wire in batches.
"""

from .cli import main

__all__ = ["main"]
__version__ = "0.0.1"
