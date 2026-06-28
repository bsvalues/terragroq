"""Tests for copilot.memory — TDD: write tests first, then implement."""
import threading
import pytest
from copilot.memory import Memory


def test_start_session_returns_string(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    assert isinstance(sid, str)
    assert len(sid) > 0


def test_recent_returns_messages_oldest_first(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    mem.append(sid, "user", "hello")
    mem.append(sid, "assistant", "hi there")
    msgs = mem.recent(sid)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "hello"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "hi there"


def test_meta_roundtrips_as_dict(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    meta = {"tool": "bash", "exit_code": 0}
    mem.append(sid, "tool", "output", meta=meta)
    msgs = mem.recent(sid)
    assert msgs[0]["meta"] == meta


def test_meta_none_when_not_provided(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    mem.append(sid, "user", "no meta")
    msgs = mem.recent(sid)
    assert msgs[0]["meta"] is None


def test_remember_fact_and_facts(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("user likes Python")
    result = mem.facts()
    assert isinstance(fact_id, int)
    assert isinstance(result, list)
    assert "user likes Python" in result


def test_multiple_facts(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    mem.remember_fact("fact one")
    mem.remember_fact("fact two")
    result = mem.facts()
    assert "fact one" in result
    assert "fact two" in result


def test_list_facts_includes_governance_metadata(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("fact with provenance", source="test_source")

    facts = mem.list_facts()

    assert facts[0]["id"] == fact_id
    assert facts[0]["text"] == "fact with provenance"
    assert facts[0]["source"] == "test_source"
    assert facts[0]["authority_state"] == "working"
    assert facts[0]["stale"] is False
    assert facts[0]["archived"] is False
    assert facts[0]["created"]
    assert facts[0]["updated"]
    assert facts[0]["last_used"] is None


def test_facts_excludes_stale_and_archived_items(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    active_id = mem.remember_fact("active fact")
    stale_id = mem.remember_fact("stale fact")
    archived_id = mem.remember_fact("archived fact")

    mem.mark_fact_stale(stale_id, True)
    mem.archive_fact(archived_id)

    facts = mem.facts()

    assert "active fact" in facts
    assert "stale fact" not in facts
    assert "archived fact" not in facts
    active = mem.get_fact(active_id)
    assert active["last_used"] is not None


def test_mark_fact_stale_can_restore_to_working(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("temporary fact")

    stale = mem.mark_fact_stale(fact_id, True)
    restored = mem.mark_fact_stale(fact_id, False)

    assert stale["stale"] is True
    assert stale["authority_state"] == "deprecated"
    assert restored["stale"] is False
    assert restored["authority_state"] == "working"


def test_update_fact_text_changes_text_and_source(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("old fact")

    updated = mem.update_fact_text(fact_id, "new fact")

    assert updated["text"] == "new fact"
    assert updated["source"] == "operator_edit"
    assert mem.facts() == ["new fact"]


def test_archive_fact_is_soft_delete(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("remove me")

    archived = mem.archive_fact(fact_id)

    assert archived["archived"] is True
    assert archived["authority_state"] == "archived"
    assert mem.facts() == []
    assert mem.list_facts() == []
    assert mem.list_facts(include_archived=True)[0]["text"] == "remove me"


def test_set_fact_authority_validates_state(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("fact")

    canon = mem.set_fact_authority(fact_id, "canon")
    assert canon["authority_state"] == "canon"

    with pytest.raises(ValueError):
        mem.set_fact_authority(fact_id, "unknown")


def test_fact_audit_records_memory_actions(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("audit me", source="test")

    mem.update_fact_text(fact_id, "audit me edited", evidence={"reason": "correction"})
    mem.mark_fact_stale(fact_id, True, evidence={"reason": "old"})
    mem.set_fact_authority(fact_id, "reviewed", evidence={"approved_by": "Bill"})

    events = mem.fact_audit(fact_id)
    actions = [event["action"] for event in events]

    assert actions[:3] == ["authority_changed", "marked_stale", "edited"]
    assert "created" in actions
    assert events[0]["detail"]["authority_state"] == "reviewed"
    assert events[0]["detail"]["evidence"]["approved_by"] == "Bill"


def test_review_queue_groups_memory_states(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    working = mem.remember_fact("needs review")
    stale = mem.remember_fact("stale fact")
    canon = mem.remember_fact("canon fact")

    mem.mark_fact_stale(stale, True)
    mem.set_fact_authority(canon, "canon")

    queue = mem.review_queue()

    assert [fact["id"] for fact in queue["needs_review"]] == [working]
    assert [fact["id"] for fact in queue["stale"]] == [stale]
    assert [fact["id"] for fact in queue["canon"]] == [canon]
    assert queue["counts"]["needs_review"] == 1
    assert queue["counts"]["stale"] == 1
    assert queue["counts"]["canon"] == 1


def test_duplicate_fact_sets_conflict_indicator(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    first = mem.remember_fact("Same fact")
    second = mem.remember_fact("same   fact")

    facts = {fact["id"]: fact for fact in mem.list_facts()}

    assert facts[first]["conflict"] is True
    assert facts[second]["conflict"] is True
    assert facts[first]["conflict_with"] == [second]
    assert facts[second]["conflict_with"] == [first]


def test_export_facts_json_and_markdown(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    fact_id = mem.remember_fact("exported fact", source="unit-test")
    mem.set_fact_authority(fact_id, "canon", evidence={"approved_by": "Bill"})

    json_export = mem.export_facts("json")
    md_export = mem.export_facts("markdown")

    assert json_export["format"] == "json"
    assert json_export["facts"][0]["citation"] == f"memory.fact:{fact_id}"
    assert md_export["format"] == "markdown"
    assert "WilliamOS Memory Export" in md_export["content"]
    assert "exported fact" in md_export["content"]
    assert f"memory.fact:{fact_id}" in md_export["content"]


def test_persistence_across_reopen(tmp_path):
    db = tmp_path / "test.db"
    mem1 = Memory(str(db))
    sid = mem1.start_session()
    mem1.append(sid, "user", "persisted message")
    mem1.remember_fact("persisted fact")

    # Reopen with a new Memory instance on same db
    mem2 = Memory(str(db))
    msgs = mem2.recent(sid)
    assert len(msgs) == 1
    assert msgs[0]["content"] == "persisted message"
    facts = mem2.facts()
    assert "persisted fact" in facts


def test_recent_limit(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    for i in range(25):
        mem.append(sid, "user", f"msg {i}")
    msgs = mem.recent(sid, limit=10)
    assert len(msgs) == 10
    # Should be the 10 most recent (oldest-first within that window)
    assert msgs[-1]["content"] == "msg 24"


def test_session_isolation(tmp_path):
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid1 = mem.start_session()
    sid2 = mem.start_session()
    mem.append(sid1, "user", "in session 1")
    mem.append(sid2, "user", "in session 2")
    assert len(mem.recent(sid1)) == 1
    assert mem.recent(sid1)[0]["content"] == "in session 1"
    assert len(mem.recent(sid2)) == 1
    assert mem.recent(sid2)[0]["content"] == "in session 2"


def test_memory_usable_across_threads(tmp_path):
    """Memory created in one thread must be usable from another thread (FastAPI worker simulation)."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()

    errors = []

    def worker():
        try:
            mem.append(sid, "user", "hi")
            msgs = mem.recent(sid)
            assert len(msgs) == 1
            assert msgs[0]["content"] == "hi"
        except Exception as exc:
            errors.append(exc)

    t = threading.Thread(target=worker)
    t.start()
    t.join()

    assert errors == [], f"Thread raised: {errors[0]}"
    assert mem.recent(sid)[0]["content"] == "hi"


def test_list_sessions_orders_and_counts(tmp_path):
    """list_sessions returns sessions most-recent-first with correct message_count and preview."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))

    sid1 = mem.start_session()
    mem.append(sid1, "user", "hello from session one")
    mem.append(sid1, "assistant", "reply")

    sid2 = mem.start_session()
    mem.append(sid2, "assistant", "assistant only, no user msg")

    sessions = mem.list_sessions()

    assert len(sessions) == 2
    # Most-recent-first: sid2 was created after sid1
    assert sessions[0]["id"] == sid2
    assert sessions[1]["id"] == sid1

    # message_count
    assert sessions[0]["message_count"] == 1
    assert sessions[1]["message_count"] == 2

    # preview: sid1 has a user message; sid2 does not
    assert sessions[1]["preview"] == "hello from session one"
    assert sessions[0]["preview"] == ""


def test_list_sessions_preview_truncated(tmp_path):
    """list_sessions truncates preview at ~80 chars."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    long_msg = "x" * 100
    mem.append(sid, "user", long_msg)

    sessions = mem.list_sessions()
    assert len(sessions[0]["preview"]) <= 82  # 80 chars + ellipsis char


def test_get_session_returns_messages_in_order(tmp_path):
    """get_session returns messages oldest-first with correct shape."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()

    mem.append(sid, "user", "first")
    mem.append(sid, "assistant", "second", meta={"tokens": 5})
    mem.append(sid, "user", "third")

    msgs = mem.get_session(sid)
    assert len(msgs) == 3
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "first"
    assert msgs[0]["meta"] is None
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["meta"] == {"tokens": 5}
    assert msgs[2]["content"] == "third"


def test_get_session_limit(tmp_path):
    """get_session respects the limit parameter."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    sid = mem.start_session()
    for i in range(10):
        mem.append(sid, "user", f"msg {i}")

    msgs = mem.get_session(sid, limit=3)
    assert len(msgs) == 3
    assert msgs[0]["content"] == "msg 0"
    assert msgs[2]["content"] == "msg 2"


def test_get_session_unknown_returns_empty(tmp_path):
    """get_session with a non-existent session id returns empty list."""
    db = tmp_path / "test.db"
    mem = Memory(str(db))
    msgs = mem.get_session("nonexistent-id")
    assert msgs == []
