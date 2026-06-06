"""LiteLLM-backed dispatch gateway.

Public surface:
    from tracebility_api.llm import dispatch, DispatchResult, DispatchError
"""

from .gateway import dispatch
from .types import DispatchError, DispatchResult, Message

__all__ = ["dispatch", "DispatchError", "DispatchResult", "Message"]
