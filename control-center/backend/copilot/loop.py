"""WilliamOS Co-Pilot — Agent Loop.

Orchestrates multi-step LLM ↔ tool interactions with a human-approval gate.

Public API
----------
run_turn(user_msg, session, memory, llm_chat=None, stream_fn=None, max_steps=8) -> Iterator[dict]
    Yields events:
        {"type": "token",    "text": str}                         (streaming only)
        {"type": "tool",     "name": str, "status": "ok" | "failed"}
        {"type": "approval", "name": str, "reason": str, "call_id": str}
        {"type": "final",    "text": str}

resume(call_id, approved, session, memory, pending, llm_chat=None, stream_fn=None) -> Iterator[dict]
    Continues a paused turn after the operator approves or denies a tool.

Pending-state shape
-------------------
pending[call_id] = {
    "name":      str,          # tool name that triggered the pause
    "arguments": dict,         # arguments for that tool call
    "messages":  list[dict],   # accumulated messages up to the pause point
    "steps":     int,          # how many steps have already run
    "max_steps": int,
    "llm_chat":  callable,
    "stream_fn": callable | None,
    "session":   str,
    "memory":    Memory,
    "executed":  set,          # (name, args_json) keys already run this turn
}
"""

from __future__ import annotations

import json
import secrets
import time
from typing import TYPE_CHECKING, Any, Callable, Iterator

from copilot import tools
from copilot.prompts import SYSTEM

if TYPE_CHECKING:
    from copilot.memory import Memory


def _default_llm_chat():
    from copilot import llm
    return llm.chat


def _build_messages(
    user_msg: str,
    session: str,
    memory: "Memory",
    search_fn=None,
) -> list[dict]:
    """Assemble [system] + recent-history + user (with facts and vault notes folded into user turn)."""
    if search_fn is None:
        from copilot.retrieval import search as _search
        search_fn = _search

    messages: list[dict] = [{"role": "system", "content": SYSTEM}]

    for msg in memory.recent(session, limit=20):
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Retrieve relevant vault notes (never let retrieval break a turn)
    try:
        results = search_fn(user_msg, k=3)
    except Exception:
        results = []

    # Filter: keep keyword fallback (score is None) OR semantic score >= 0.35
    relevant = [r for r in results if r.get("score") is None or r.get("score", 0) >= 0.35]

    facts = memory.facts()
    prefix_parts: list[str] = []

    if facts:
        facts_lines = "\n".join(f"- {f}" for f in facts)
        prefix_parts.append(f"(Context — known facts about me:\n{facts_lines})")

    if relevant:
        note_lines = "\n".join(f"- [{r['path']}]: {r['excerpt']}" for r in relevant)
        prefix_parts.append(
            f"(Relevant notes from your vault — cite the path if you use one:\n{note_lines})"
        )

    if prefix_parts:
        prefixed = "\n\n".join(prefix_parts) + "\n\n" + user_msg
        messages.append({"role": "user", "content": prefixed})
    else:
        messages.append({"role": "user", "content": user_msg})

    return messages


def _tool_key(name: str, arguments: dict) -> tuple[str, str]:
    """Return a hashable dedup key for a tool call."""
    return (name, json.dumps(arguments, sort_keys=True))


def _direct_tool_call(user_msg: str) -> dict[str, Any] | None:
    """Deterministic guards for high-value operator phrases.

    These keep common governance checks out of the large tool-catalog routing
    path, where a local model can confuse status checks with write commands.
    """
    text = " ".join(user_msg.lower().strip().split())

    if "backup" in text and any(word in text for word in ("status", "health", "readiness")):
        return {"name": "backup-status", "arguments": {}}

    if "snapshot" in text and any(word in text for word in ("now", "take", "create", "commit")):
        return {"name": "snapshot", "arguments": {}}

    return None


def _summarize_if_empty(content: str, messages: list[dict], llm_chat: Callable, tools_ran: bool) -> str:
    """If content is empty/whitespace after tools ran, ask the model to summarize."""
    if content and content.strip():
        return content
    if not tools_ran:
        return content
    try:
        summarize_messages = messages + [
            {"role": "user", "content": "Summarize the tool results above for the operator in plain English."}
        ]
        resp = llm_chat(summarize_messages)
        summary = resp.get("content", "")
        if summary and summary.strip():
            return summary
    except Exception:
        pass
    return "(no answer produced)"


def _runtime_meta(response: dict[str, Any] | None) -> dict[str, Any] | None:
    if not response:
        return None
    runtime = response.get("runtime")
    return runtime if isinstance(runtime, dict) else None


def _finalize_tool_result(
    messages: list[dict],
    session: str,
    memory: "Memory",
    user_msg: str,
    llm_chat: Callable,
    tool_name: str = "command",
    observation: str = "",
    stream_fn=None,
) -> Iterator[dict]:
    """Summarize a completed direct tool result and persist the turn."""
    clean_observation = observation.strip() or "No command output was returned."
    content = f"{tool_name} completed.\n\n{clean_observation}"
    if stream_fn is not None:
        yield {"type": "token", "text": content}
        time.sleep(0.05)

    memory.append(session, "user", user_msg)
    memory.append(session, "assistant", content)
    yield {"type": "final", "text": content}


def _run_direct_tool_turn(
    tool_call: dict[str, Any],
    messages: list[dict],
    session: str,
    memory: "Memory",
    llm_chat: Callable,
    user_msg: str,
    pending: dict | None = None,
    stream_fn=None,
) -> Iterator[dict]:
    """Run a deterministic direct tool call through the normal safety gate."""
    name = tool_call["name"]
    arguments = tool_call.get("arguments", {})
    result = tools.run(name, arguments)

    if result.get("needs_confirm"):
        call_id = secrets.token_hex(8)
        event = {
            "type": "approval",
            "name": name,
            "reason": result.get("confirm_reason", ""),
            "call_id": call_id,
        }
        if pending is not None:
            pending[call_id] = {
                "name": name,
                "arguments": arguments,
                "messages": messages,
                "steps": 0,
                "max_steps": 1,
                "llm_chat": llm_chat,
                "stream_fn": stream_fn,
                "session": session,
                "memory": memory,
                "user_msg": user_msg,
                "executed": set(),
                "direct_tool": True,
            }
        yield event
        return

    status = "ok" if result.get("ok") else "failed"
    observation = result.get("observation", "")
    messages.append({"role": "tool", "content": observation, "name": name})
    yield {"type": "tool", "name": name, "status": status}
    yield from _finalize_tool_result(
        messages,
        session,
        memory,
        user_msg,
        llm_chat,
        tool_name=name,
        observation=observation,
        stream_fn=stream_fn,
    )


def _inner_loop(
    messages: list[dict],
    steps_used: int,
    max_steps: int,
    session: str,
    memory: "Memory",
    llm_chat: Callable,
    user_msg: str,
    executed: set | None = None,
    stream_fn=None,
) -> Iterator[dict]:
    """Core step loop. Yields events; persists the turn on clean finish."""
    if executed is None:
        executed = set()

    step = steps_used
    tools_ran_this_turn = len(executed) > 0  # already ran before a resume

    while step < max_steps:
        if stream_fn is not None:
            # Streaming path: consume delta/done events from stream_fn
            response = None
            error_occurred = False
            for ev in stream_fn(messages, tools=tools.catalog()):
                if ev["type"] == "delta":
                    yield {"type": "token", "text": ev["text"]}
                elif ev["type"] == "done":
                    if ev.get("error"):
                        yield {
                            "type": "error",
                            "text": (
                                f"Co-pilot model error: {ev['error']}. "
                                "Is Ollama running? Try: python scripts/setup_copilot.py"
                            ),
                        }
                        error_occurred = True
                    else:
                        response = {
                            "content": ev["content"],
                            "tool_calls": ev["tool_calls"],
                            "runtime": ev.get("runtime"),
                        }
                    break
            if error_occurred:
                return
        else:
            # Non-streaming path — used by existing tests (llm_chat fake injected)
            try:
                response = llm_chat(messages, tools=tools.catalog())
            except Exception as exc:
                yield {
                    "type": "error",
                    "text": (
                        f"Co-pilot model error: {str(exc)[:200]}. "
                        "Is Ollama running? Try: python scripts/setup_copilot.py"
                    ),
                }
                return

        tool_calls: list[dict[str, Any]] = response.get("tool_calls", [])
        content: str = response.get("content", "")

        if not tool_calls:
            # Clean finish
            content = _summarize_if_empty(content, messages, llm_chat, tools_ran_this_turn)
            memory.append(session, "user", user_msg)
            runtime = _runtime_meta(response)
            memory.append(session, "assistant", content, meta={"model_runtime": runtime} if runtime else None)
            event = {"type": "final", "text": content}
            if runtime:
                event["runtime"] = runtime
            yield event
            return

        # Process each tool call in this step
        all_duplicates = True
        for tc in tool_calls:
            name = tc["name"]
            arguments = tc.get("arguments", {})
            key = _tool_key(name, arguments)

            if key in executed:
                # Duplicate — inject a synthetic tool message, skip execution
                messages.append(
                    {"role": "tool", "content": f"[already ran {name}; see previous result]", "name": name}
                )
                # do NOT yield a 'tool' event for duplicates
                continue

            all_duplicates = False

            # ------------------------------------------------------------------
            # Intercept the synthetic 'remember' tool — never route through
            # safety.check_command or command_runner.
            # ------------------------------------------------------------------
            if name == tools.REMEMBER:
                fact = arguments.get("fact", "").strip()
                if fact:
                    memory.remember_fact(fact)
                executed.add(key)
                tools_ran_this_turn = True
                messages.append(
                    {"role": "tool", "content": f"[remembered: {fact}]", "name": name}
                )
                yield {"type": "tool", "name": name, "status": "ok"}
                continue

            result = tools.run(name, arguments)

            if result.get("needs_confirm"):
                # Pause and hand off to resume()
                call_id = secrets.token_hex(8)
                yield {
                    "type": "approval",
                    "name": name,
                    "reason": result.get("confirm_reason", ""),
                    "call_id": call_id,
                    # Internal — loop state is stored by run_turn into pending
                    "_state": {
                        "name": name,
                        "arguments": arguments,
                        "messages": messages,
                        "steps": step + 1,
                        "max_steps": max_steps,
                        "llm_chat": llm_chat,
                        "stream_fn": stream_fn,
                        "session": session,
                        "memory": memory,
                        "user_msg": user_msg,
                        "executed": executed,
                    },
                }
                return  # Stop iterator; resume() continues later

            # Tool ran successfully — record key, append observation, yield event
            executed.add(key)
            tools_ran_this_turn = True
            status = "ok" if result.get("ok") else "failed"
            observation = result.get("observation", "")
            messages.append(
                {"role": "tool", "content": observation, "name": name}
            )
            yield {"type": "tool", "name": name, "status": status}

        if all_duplicates:
            # Every call this step was a duplicate — break to forced-final to avoid spinning
            break

        step += 1

    # max_steps exhausted (or all-duplicate break) — force a final with whatever content we have
    # Use non-streaming llm_chat for this fallback call (keep it simple)
    try:
        response = llm_chat(messages, tools=tools.catalog())
    except Exception as exc:
        yield {
            "type": "error",
            "text": (
                f"Co-pilot model error: {str(exc)[:200]}. "
                "Is Ollama running? Try: python scripts/setup_copilot.py"
            ),
        }
        return
    content = response.get("content", "")
    content = _summarize_if_empty(content, messages, llm_chat, tools_ran_this_turn)
    if not content:
        content = "[max steps reached]"
    memory.append(session, "user", user_msg)
    runtime = _runtime_meta(response)
    memory.append(session, "assistant", content, meta={"model_runtime": runtime} if runtime else None)
    event = {"type": "final", "text": content}
    if runtime:
        event["runtime"] = runtime
    yield event


def run_turn(
    user_msg: str,
    session: str,
    memory: "Memory",
    llm_chat: Callable | None = None,
    max_steps: int = 8,
    pending: dict | None = None,
    search_fn=None,
    stream_fn=None,
) -> Iterator[dict]:
    """Run one conversational turn, yielding events.

    Args:
        user_msg:  The user's message text.
        session:   Session id from memory.start_session().
        memory:    Memory instance.
        llm_chat:  Injectable LLM callable; defaults to llm.chat when None.
        max_steps: Maximum tool-call steps before forcing a final event.
        pending:   Mutable dict for storing paused-turn state (keyed by
                   call_id). Pass the same dict to resume() to continue.
        search_fn: Injectable vault search callable; defaults to retrieval.search.
        stream_fn: Optional streaming callable (e.g. llm.stream_chat). When
                   provided, tokens are yielded as {"type": "token", "text": str}
                   events before the final response. When None, uses llm_chat
                   (non-streaming) path — required for existing tests.
    """
    if llm_chat is None:
        llm_chat = _default_llm_chat()

    messages = _build_messages(user_msg, session, memory, search_fn=search_fn)
    direct_tool = _direct_tool_call(user_msg)
    if direct_tool is not None:
        yield from _run_direct_tool_turn(
            direct_tool,
            messages=messages,
            session=session,
            memory=memory,
            llm_chat=llm_chat,
            user_msg=user_msg,
            pending=pending,
            stream_fn=stream_fn,
        )
        return

    executed: set = set()

    for event in _inner_loop(
        messages=messages,
        steps_used=0,
        max_steps=max_steps,
        session=session,
        memory=memory,
        llm_chat=llm_chat,
        user_msg=user_msg,
        executed=executed,
        stream_fn=stream_fn,
    ):
        if event["type"] == "approval" and pending is not None:
            call_id = event["call_id"]
            state = event.pop("_state")
            pending[call_id] = state
        elif event["type"] == "approval":
            # Remove internal key even if caller didn't pass pending
            event.pop("_state", None)

        yield event


def resume(
    call_id: str,
    approved: bool,
    session: str,
    memory: "Memory",
    pending: dict,
    llm_chat: Callable | None = None,
    stream_fn=None,
) -> Iterator[dict]:
    """Continue a paused turn after the operator approves or denies a tool.

    Args:
        call_id:   The call_id from the 'approval' event.
        approved:  True if the operator approved; False to decline.
        session:   Session id.
        memory:    Memory instance.
        pending:   The same dict passed to run_turn(); state is looked up here.
        llm_chat:  Optional override; falls back to the one stored in pending.
        stream_fn: Optional streaming callable override; falls back to pending state.
    """
    state = pending.pop(call_id, None)
    if state is None:
        yield {"type": "final", "text": "[error: unknown call_id]"}
        return

    name = state["name"]
    arguments = state["arguments"]
    messages: list[dict] = state["messages"]
    steps = state["steps"]
    max_steps = state["max_steps"]
    chat_fn = llm_chat or state["llm_chat"]
    resolved_stream_fn = stream_fn if stream_fn is not None else state.get("stream_fn")
    user_msg = state["user_msg"]
    executed: set = state.get("executed", set())
    direct_tool = bool(state.get("direct_tool"))

    if approved:
        result = tools.run(name, arguments, confirmed=True)
        status = "ok" if result.get("ok") else "failed"
        observation = result.get("observation", "")
        # Record the confirmed call in the executed set
        executed.add(_tool_key(name, arguments))
        messages.append(
            {"role": "tool", "content": observation, "name": name}
        )
        yield {"type": "tool", "name": name, "status": status}
        if direct_tool:
            yield from _finalize_tool_result(
                messages,
                session=session,
                memory=memory,
                user_msg=user_msg,
                llm_chat=chat_fn,
                tool_name=name,
                observation=observation,
                stream_fn=resolved_stream_fn,
            )
            return
    else:
        messages.append(
            {"role": "tool", "content": "[declined by operator]", "name": name}
        )
        if direct_tool:
            content = f"Denied. No command was executed for william {name}."
            memory.append(session, "user", user_msg)
            memory.append(session, "assistant", content)
            yield {"type": "final", "text": content}
            return

    yield from _inner_loop(
        messages=messages,
        steps_used=steps,
        max_steps=max_steps,
        session=session,
        memory=memory,
        llm_chat=chat_fn,
        user_msg=user_msg,
        executed=executed,
        stream_fn=resolved_stream_fn,
    )
