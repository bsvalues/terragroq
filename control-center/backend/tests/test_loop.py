"""Tests for copilot.loop — agent loop with confirm-pause + step cap."""

from copilot import loop


# ---------------------------------------------------------------------------
# _build_messages — facts folded into user turn
# ---------------------------------------------------------------------------

def test_build_messages_folds_facts_into_user_turn(tmp_path):
    """Facts must appear in the user turn content, not as separate system messages."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    mem.remember_fact("Favorite project is TerraFusion")
    sess = mem.start_session()

    messages = loop._build_messages("what is my favorite project?", sess, mem)

    last = messages[-1]
    assert last["role"] == "user"
    assert "TerraFusion" in last["content"]
    assert "what is my favorite project?" in last["content"]

    # No message must have content starting with "[fact]"
    for msg in messages:
        assert not msg["content"].startswith("[fact]"), (
            f"Found old-style [fact] system message: {msg}"
        )


def test_build_messages_no_facts_unchanged_user_msg(tmp_path):
    """With no facts and no retrieved notes the user message passes through unmodified."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    # Disable retrieval so this isolates the no-facts pass-through behavior
    # (default search_fn hits the real vault index, which is exercised elsewhere).
    messages = loop._build_messages("hello world", sess, mem, search_fn=lambda *a, **k: [])

    last = messages[-1]
    assert last["role"] == "user"
    assert last["content"] == "hello world"


def test_persisted_user_message_is_original(tmp_path, monkeypatch):
    """After run_turn, memory.recent() must store the original user_msg, not the facts-prefixed version."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    mem.remember_fact("Favorite project is TerraFusion")
    sess = mem.start_session()

    seq = [{"content": "TerraFusion is your favorite.", "tool_calls": []}]
    events = list(loop.run_turn("what is my favorite project?", sess, mem, llm_chat=fake_chat_seq(seq)))

    assert events[-1]["type"] == "final"

    recent = mem.recent(sess, limit=10)
    user_msgs = [r for r in recent if r["role"] == "user"]
    assert len(user_msgs) == 1
    stored = user_msgs[0]["content"]
    assert stored == "what is my favorite project?"
    assert "(Context" not in stored


def fake_chat_seq(seq):
    calls = {"i": 0}

    def _chat(messages, tools=None):
        r = seq[calls["i"]]
        calls["i"] += 1
        return r

    return _chat


def test_loop_runs_tool_then_finalizes(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()
    seq = [
        {"content": "", "tool_calls": [{"name": "backup-status", "arguments": {}}]},
        {"content": "Your backup is healthy.", "tool_calls": []},
    ]
    monkeypatch.setattr(
        "copilot.tools.run",
        lambda n, a, confirmed=False: {"ok": True, "observation": "4 archives", "needs_confirm": False, "confirm_reason": None},
    )
    events = list(loop.run_turn("backup ok?", sess, mem, llm_chat=fake_chat_seq(seq)))
    types = [e["type"] for e in events]
    assert "tool" in types and types[-1] == "final"


def test_direct_backup_status_intent_runs_backup_status(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()
    run_calls = []

    def fake_run(n, a, confirmed=False):
        run_calls.append({"name": n, "args": a, "confirmed": confirmed})
        return {"ok": True, "observation": "4 archives", "needs_confirm": False, "confirm_reason": None}

    monkeypatch.setattr("copilot.tools.run", fake_run)

    seq = []
    events = list(loop.run_turn(
        "what is my backup status?",
        sess,
        mem,
        llm_chat=fake_chat_seq(seq),
        search_fn=lambda *a, **k: [],
    ))

    assert run_calls == [{"name": "backup-status", "args": {}, "confirmed": False}]
    assert events[0] == {"type": "tool", "name": "backup-status", "status": "ok"}
    assert events[-1] == {"type": "final", "text": "backup-status completed.\n\n4 archives"}


def test_direct_snapshot_intent_pauses_and_denial_does_not_execute(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()
    run_calls = []

    def fake_run(n, a, confirmed=False):
        run_calls.append({"name": n, "confirmed": confirmed})
        return {
            "ok": False,
            "observation": "",
            "needs_confirm": not confirmed,
            "confirm_reason": "Creates a git commit",
        }

    monkeypatch.setattr("copilot.tools.run", fake_run)

    pending = {}
    events = list(loop.run_turn(
        "snapshot now",
        sess,
        mem,
        llm_chat=fake_chat_seq([]),
        pending=pending,
        search_fn=lambda *a, **k: [],
    ))

    approval = events[0]
    assert approval["type"] == "approval"
    assert approval["name"] == "snapshot"
    assert approval["call_id"] in pending

    calls_before = len(run_calls)
    resume_events = list(loop.resume(approval["call_id"], approved=False, session=sess, memory=mem, pending=pending))

    assert len(run_calls) == calls_before
    assert not any(c["confirmed"] for c in run_calls)
    assert resume_events == [{"type": "final", "text": "Denied. No command was executed for william snapshot."}]


def test_loop_pauses_on_confirm(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()
    seq = [
        {"content": "", "tool_calls": [{"name": "snapshot", "arguments": {}}]},
    ]
    monkeypatch.setattr(
        "copilot.tools.run",
        lambda n, a, confirmed=False: {
            "ok": False,
            "observation": "",
            "needs_confirm": True,
            "confirm_reason": "snapshot writes disk",
        },
    )
    events = list(loop.run_turn("take a snapshot", sess, mem, llm_chat=fake_chat_seq(seq)))
    types = [e["type"] for e in events]
    assert "approval" in types
    # Iterator must stop — no final event after approval
    assert "final" not in types


def test_loop_respects_max_steps(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    # Always returns a tool_call — would loop forever without the cap
    def always_tool(messages, tools=None):
        return {"content": "", "tool_calls": [{"name": "backup-status", "arguments": {}}]}

    monkeypatch.setattr(
        "copilot.tools.run",
        lambda n, a, confirmed=False: {"ok": True, "observation": "ok", "needs_confirm": False, "confirm_reason": None},
    )
    max_steps = 4
    events = list(loop.run_turn("loop forever?", sess, mem, llm_chat=always_tool, max_steps=max_steps))
    tool_events = [e for e in events if e["type"] == "tool"]
    assert len(tool_events) <= max_steps
    assert events[-1]["type"] == "final"


def test_resume_approved_executes_tool(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    # First LLM call returns a tool that needs confirmation; second finalizes.
    seq = [
        {"content": "", "tool_calls": [{"name": "snapshot", "arguments": {"disk": "/dev/sda"}}]},
        {"content": "Snapshot done.", "tool_calls": []},
    ]

    run_calls = []

    def fake_tools_run(n, a, confirmed=False):
        run_calls.append({"name": n, "args": a, "confirmed": confirmed})
        if not confirmed:
            # First call from _inner_loop — needs confirmation
            return {"ok": False, "observation": "", "needs_confirm": True, "confirm_reason": "writes disk"}
        # Called from resume() with confirmed=True
        return {"ok": True, "observation": "snapshot created", "needs_confirm": False, "confirm_reason": None}

    monkeypatch.setattr("copilot.tools.run", fake_tools_run)

    pending = {}
    events = list(loop.run_turn("take snapshot", sess, mem, llm_chat=fake_chat_seq(seq), pending=pending))

    # Sanity: paused on approval
    approval_events = [e for e in events if e["type"] == "approval"]
    assert len(approval_events) == 1
    call_id = approval_events[0]["call_id"]
    assert call_id in pending

    # Resume approved — provide a fresh finalizing chat sequence
    seq2 = [{"content": "Snapshot done.", "tool_calls": []}]
    resume_events = list(
        loop.resume(call_id, approved=True, session=sess, memory=mem, pending=pending, llm_chat=fake_chat_seq(seq2))
    )

    # tools.run must have been called again with confirmed=True
    confirmed_calls = [c for c in run_calls if c["confirmed"]]
    assert len(confirmed_calls) == 1
    assert confirmed_calls[0]["name"] == "snapshot"

    # Turn must finalize
    assert resume_events[-1]["type"] == "final"


def test_loop_yields_error_event_on_llm_failure(tmp_path):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def exploding_chat(messages, tools=None):
        raise RuntimeError("boom")

    events = list(loop.run_turn("hello", sess, mem, llm_chat=exploding_chat))
    # Must not propagate — we got here, so no exception
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "boom" in error_events[0]["text"]
    # Loop must terminate (finite events)
    assert len(events) == 1


def test_resume_denied_does_not_execute_tool(tmp_path, monkeypatch):
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    seq = [
        {"content": "", "tool_calls": [{"name": "snapshot", "arguments": {}}]},
    ]

    run_calls = []

    def fake_tools_run(n, a, confirmed=False):
        run_calls.append({"name": n, "confirmed": confirmed})
        # Always needs confirm when not confirmed; should never be called with confirmed=True in deny path
        return {"ok": False, "observation": "", "needs_confirm": True, "confirm_reason": "writes disk"}

    monkeypatch.setattr("copilot.tools.run", fake_tools_run)

    pending = {}
    events = list(loop.run_turn("take snapshot", sess, mem, llm_chat=fake_chat_seq(seq), pending=pending))

    approval_events = [e for e in events if e["type"] == "approval"]
    assert len(approval_events) == 1
    call_id = approval_events[0]["call_id"]

    # Capture run_calls count before resume
    calls_before = len(run_calls)

    # Resume denied — provide a finalizing chat so the loop ends
    seq2 = [{"content": "Skipped snapshot.", "tool_calls": []}]
    resume_events = list(
        loop.resume(call_id, approved=False, session=sess, memory=mem, pending=pending, llm_chat=fake_chat_seq(seq2))
    )

    # tools.run must NOT have been called again after the pause
    assert len(run_calls) == calls_before

    # Turn must still finalize
    assert resume_events[-1]["type"] == "final"


def test_loop_skips_duplicate_tool_calls(tmp_path, monkeypatch):
    """tools.run must be called only once when the model repeats the same tool call."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    # Step 1: model returns backup-status
    # Step 2: model returns the SAME backup-status (duplicate)
    # Step 3: model returns a final text with no tool_calls
    seq = [
        {"content": "", "tool_calls": [{"name": "backup-status", "arguments": {}}]},
        {"content": "", "tool_calls": [{"name": "backup-status", "arguments": {}}]},
        {"content": "Backup looks good.", "tool_calls": []},
    ]

    run_call_count = {"n": 0}

    def counting_run(n, a, confirmed=False):
        run_call_count["n"] += 1
        return {"ok": True, "observation": "4 archives", "needs_confirm": False, "confirm_reason": None}

    monkeypatch.setattr("copilot.tools.run", counting_run)

    events = list(loop.run_turn("check backup", sess, mem, llm_chat=fake_chat_seq(seq)))

    # tools.run called exactly once — duplicate was skipped
    assert run_call_count["n"] == 1

    # Must still reach a final event
    types = [e["type"] for e in events]
    assert types[-1] == "final"


def test_loop_summarizes_when_final_empty_after_tool(tmp_path, monkeypatch):
    """When clean-finish content is empty but tools ran, loop makes a summarize call."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    # Step 1: tool call runs
    # Step 2: model returns empty content (clean-finish-empty) → triggers summarize
    # Step 3 (summarize call, no tools= passed): returns the actual summary
    seq = [
        {"content": "", "tool_calls": [{"name": "backup-status", "arguments": {}}]},
        {"content": "", "tool_calls": []},          # empty clean finish → triggers summarize
        {"content": "Your backup is healthy.", "tool_calls": []},   # summarize response
    ]

    monkeypatch.setattr(
        "copilot.tools.run",
        lambda n, a, confirmed=False: {
            "ok": True,
            "observation": "4 archives",
            "needs_confirm": False,
            "confirm_reason": None,
        },
    )

    events = list(loop.run_turn("check backup", sess, mem, llm_chat=fake_chat_seq(seq)))

    final_events = [e for e in events if e["type"] == "final"]
    assert len(final_events) == 1
    assert final_events[0]["text"] == "Your backup is healthy."


# ---------------------------------------------------------------------------
# vault RAG injection via search_fn
# ---------------------------------------------------------------------------

def test_build_messages_injects_relevant_notes(tmp_path):
    """High-score results must be injected into the user turn with path and excerpt."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def mock_search(query, k=3):
        return [{"path": "WilliamOS/03_Doctrine/x.md", "excerpt": "public trust is the moat", "score": 0.8}]

    messages = loop._build_messages("what is the moat?", sess, mem, search_fn=mock_search)

    last = messages[-1]
    assert last["role"] == "user"
    assert "WilliamOS/03_Doctrine/x.md" in last["content"]
    assert "public trust is the moat" in last["content"]
    assert "what is the moat?" in last["content"]


def test_build_messages_skips_lowscore_notes(tmp_path):
    """Results with score below 0.35 must NOT be injected."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def mock_search(query, k=3):
        return [{"path": "WilliamOS/03_Doctrine/x.md", "excerpt": "irrelevant noise", "score": 0.1}]

    messages = loop._build_messages("backup status", sess, mem, search_fn=mock_search)

    last = messages[-1]
    assert last["role"] == "user"
    assert last["content"] == "backup status"
    assert "Relevant notes" not in last["content"]


def test_build_messages_keeps_keyword_fallback(tmp_path):
    """Results with score=None (keyword fallback) must always be injected."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def mock_search(query, k=3):
        return [{"path": "WilliamOS/journal.md", "excerpt": "keyword match here", "score": None}]

    messages = loop._build_messages("search something", sess, mem, search_fn=mock_search)

    last = messages[-1]
    assert last["role"] == "user"
    assert "WilliamOS/journal.md" in last["content"]
    assert "keyword match here" in last["content"]


def test_build_messages_retrieval_error_is_safe(tmp_path):
    """If search_fn raises, no exception propagates and user turn is the original message."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def exploding_search(query, k=3):
        raise RuntimeError("index not found")

    messages = loop._build_messages("hello", sess, mem, search_fn=exploding_search)

    last = messages[-1]
    assert last["role"] == "user"
    assert last["content"] == "hello"


def test_persisted_user_message_is_original_with_notes(tmp_path):
    """After run_turn with vault notes injected, memory must store the original user_msg."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def mock_search(query, k=3):
        return [{"path": "WilliamOS/doc.md", "excerpt": "some relevant text", "score": 0.9}]

    seq = [{"content": "Here is the answer.", "tool_calls": []}]
    events = list(loop.run_turn(
        "what does doc say?", sess, mem,
        llm_chat=fake_chat_seq(seq),
        search_fn=mock_search,
    ))

    assert events[-1]["type"] == "final"

    recent = mem.recent(sess, limit=10)
    user_msgs = [r for r in recent if r["role"] == "user"]
    assert len(user_msgs) == 1
    stored = user_msgs[0]["content"]
    assert stored == "what does doc say?"
    assert "Relevant notes" not in stored


# ---------------------------------------------------------------------------
# remember tool — durable cross-session memory
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# streaming via stream_fn
# ---------------------------------------------------------------------------

def test_loop_streams_token_events(tmp_path):
    """When stream_fn is provided, run_turn yields token events for deltas and
    a final event whose text equals the accumulated content."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    def fake_stream_fn(messages, tools=None):
        yield {"type": "delta", "text": "Hello"}
        yield {"type": "delta", "text": " world"}
        yield {"type": "done", "content": "Hello world", "tool_calls": []}

    events = list(loop.run_turn(
        "hi", sess, mem,
        stream_fn=fake_stream_fn,
        search_fn=lambda *a, **k: [],
    ))

    token_events = [e for e in events if e["type"] == "token"]
    assert len(token_events) == 2
    assert token_events[0]["text"] == "Hello"
    assert token_events[1]["text"] == " world"

    final_events = [e for e in events if e["type"] == "final"]
    assert len(final_events) == 1
    assert final_events[0]["text"] == "Hello world"


def test_loop_streaming_handles_tool_call(tmp_path, monkeypatch):
    """When stream_fn yields a done event with a tool_call, the tool path runs
    and the turn eventually reaches a final event."""
    from copilot import memory as m

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    call_count = {"n": 0}

    def fake_stream_fn(messages, tools=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            # First call: return a tool_call (no deltas)
            yield {
                "type": "done",
                "content": "",
                "tool_calls": [{"name": "backup-status", "arguments": {}}],
            }
        else:
            # Second call: clean finish
            yield {"type": "done", "content": "Backup is fine.", "tool_calls": []}

    monkeypatch.setattr(
        "copilot.tools.run",
        lambda n, a, confirmed=False: {
            "ok": True,
            "observation": "4 archives",
            "needs_confirm": False,
            "confirm_reason": None,
        },
    )

    events = list(loop.run_turn(
        "backup ok?", sess, mem,
        stream_fn=fake_stream_fn,
        search_fn=lambda *a, **k: [],
    ))

    tool_events = [e for e in events if e["type"] == "tool"]
    assert len(tool_events) == 1
    assert tool_events[0]["name"] == "backup-status"

    final_events = [e for e in events if e["type"] == "final"]
    assert len(final_events) == 1
    assert final_events[0]["text"] == "Backup is fine."


def test_loop_remember_persists_fact(tmp_path, monkeypatch):
    """remember tool call must persist the fact to memory and NOT go through tools.run."""
    from copilot import memory as m
    from copilot import tools as t

    mem = m.Memory(str(tmp_path / "c.db"))
    sess = mem.start_session()

    seq = [
        {
            "content": "",
            "tool_calls": [
                {"name": "remember", "arguments": {"fact": "User prefers concise answers"}}
            ],
        },
        {"content": "Got it, I'll keep things concise.", "tool_calls": []},
    ]

    # Monkeypatch tools.run to fail if called with "remember" — it must NOT be routed there
    original_run = t.run

    def guarded_run(name, arguments, confirmed=False):
        assert name != "remember", "tools.run must NOT be called for 'remember'"
        return original_run(name, arguments, confirmed)

    monkeypatch.setattr("copilot.tools.run", guarded_run)

    events = list(loop.run_turn("I prefer concise answers", sess, mem, llm_chat=fake_chat_seq(seq)))

    # Fact must be persisted in memory
    assert "User prefers concise answers" in mem.facts()

    # A 'tool' event with name "remember" must have been yielded
    tool_events = [e for e in events if e["type"] == "tool" and e.get("name") == "remember"]
    assert len(tool_events) == 1
    assert tool_events[0]["status"] == "ok"

    # Turn must finalize
    assert events[-1]["type"] == "final"
