"""Per-message Jinja-style substitution: each message's content is rendered
against the same variable dict; roles are preserved verbatim.

Spec decision 9: missing variables render as empty string. The legacy
single-string render path (_render_template) preserves {{ x }} when
unfilled — _render_messages diverges intentionally."""

from __future__ import annotations

from tracebility_api.routers.playground import (
    Message,
    _render_messages,
)


def test_renders_variables_per_message():
    msgs = [
        Message(role="system", content="You are a {{ tone }} assistant."),
        Message(role="human", content="Summarize: {{ doc }}"),
    ]
    out = _render_messages(msgs, {"tone": "terse", "doc": "lorem ipsum"})
    assert out == [
        Message(role="system", content="You are a terse assistant."),
        Message(role="human", content="Summarize: lorem ipsum"),
    ]


def test_missing_variable_renders_empty():
    """Per spec decision 9: a placeholder whose key is absent from the
    variables dict renders as the empty string (diverges from
    _render_template, which preserves the literal `{{ x }}`)."""
    msgs = [Message(role="human", content="Echo: {{ x }}")]
    out = _render_messages(msgs, {})
    assert out == [Message(role="human", content="Echo: ")]


def test_no_variables_passes_through():
    msgs = [
        Message(role="system", content="static prompt"),
        Message(role="human", content="hi"),
    ]
    assert _render_messages(msgs, {"unused": "value"}) == msgs


def test_returns_new_list_does_not_mutate_input():
    msgs = [Message(role="human", content="{{ x }}")]
    out = _render_messages(msgs, {"x": "y"})
    assert out is not msgs
    assert msgs[0].content == "{{ x }}"  # original untouched


def test_non_string_value_serializes_via_json():
    """Match _render_template's value-coercion behavior so saved prompts
    render the same whether the user picks the legacy single-string or
    the new structured path during the deprecation window."""
    msgs = [Message(role="human", content="ctx={{ ctx }}")]
    out = _render_messages(msgs, {"ctx": {"a": 1}})
    assert out == [Message(role="human", content='ctx={"a": 1}')]


def test_repeated_variable_in_one_content():
    """Both occurrences are substituted; re.sub default replaces all."""
    msgs = [Message(role="human", content="{{ x }} and {{ x }}")]
    assert _render_messages(msgs, {"x": "hi"}) == [Message(role="human", content="hi and hi")]


def test_whitespace_around_placeholder():
    """The regex tolerates `\\s*` on either side of the var name; both
    {{x}} and {{   x   }} resolve identically."""
    msgs = [Message(role="human", content="a={{x}} b={{   x   }}")]
    out = _render_messages(msgs, {"x": "1"})
    assert out == [Message(role="human", content="a=1 b=1")]


def test_same_var_across_multiple_messages():
    """A single variables dict is applied to every message in order."""
    msgs = [
        Message(role="system", content="tone: {{ tone }}"),
        Message(role="human", content="again, tone: {{ tone }}"),
    ]
    out = _render_messages(msgs, {"tone": "terse"})
    assert [m.content for m in out] == [
        "tone: terse",
        "again, tone: terse",
    ]


def test_returns_fresh_message_objects():
    """Pydantic equality is value-based; assert object identity too so a
    future shortcut that returns the input message unchanged on a no-op
    render would still trip the no-mutation contract."""
    msgs = [Message(role="human", content="static")]
    out = _render_messages(msgs, {})
    assert out[0] is not msgs[0]
