"""LangChain / LangGraph → tracebility callback bridge.

Drop ``TracebilityCallbackHandler`` into a LangChain runnable and
every ``on_*`` event becomes a tracebility run + span. Works with
LangGraph too — LangGraph nodes emit the same callback events.

  from tracebility_langchain import TracebilityCallbackHandler
  handler = TracebilityCallbackHandler(project_id="prj_...")
  result = chain.invoke({"input": "hello"}, config={"callbacks": [handler]})

We import LangChain lazily — this package depends on `tracebility`
(the native SDK), not on `langchain-core`. Pin LangChain in your
own project; we duck-type against ``BaseCallbackHandler``.
"""

from .handler import TracebilityCallbackHandler

__all__ = ["TracebilityCallbackHandler"]
__version__ = "0.0.1"
