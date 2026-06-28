import json
import respx
import httpx
import pytest
from copilot import llm


@pytest.fixture(autouse=True)
def reset_runtime_env(monkeypatch):
    monkeypatch.delenv("WILLIAMOS_LLM_RUNTIME", raising=False)
    monkeypatch.delenv("WILLIAMOS_LMSTUDIO_HOST", raising=False)
    monkeypatch.delenv("WILLIAMOS_LLAMA_SERVER_HOST", raising=False)
    monkeypatch.delenv("WILLIAMOS_OLLAMA_HOST", raising=False)


# ---------------------------------------------------------------------------
# chat: tool-call parsing
# ---------------------------------------------------------------------------

def test_chat_parses_tool_calls(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    with respx.mock:
        respx.post("http://127.0.0.1:11434/api/chat").mock(
            return_value=httpx.Response(
                200,
                json={
                    "message": {
                        "content": "",
                        "tool_calls": [
                            {"function": {"name": "backup-status", "arguments": {}}}
                        ],
                    }
                },
            )
        )
        out = llm.chat(
            [{"role": "user", "content": "backup ok?"}],
            tools=[{"type": "function", "function": {"name": "backup-status"}}],
        )
    assert out["tool_calls"][0]["name"] == "backup-status"
    assert out["content"] == ""


def test_chat_arguments_as_json_string(monkeypatch):
    """arguments may arrive as a JSON string — must be parsed to dict."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    with respx.mock:
        respx.post("http://127.0.0.1:11434/api/chat").mock(
            return_value=httpx.Response(
                200,
                json={
                    "message": {
                        "content": "",
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "do-thing",
                                    "arguments": '{"key": "val"}',
                                }
                            }
                        ],
                    }
                },
            )
        )
        out = llm.chat([{"role": "user", "content": "hi"}])
    assert out["tool_calls"][0]["arguments"] == {"key": "val"}


def test_chat_no_tool_calls(monkeypatch):
    """When no tool_calls key, tool_calls list must be empty."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    with respx.mock:
        respx.post("http://127.0.0.1:11434/api/chat").mock(
            return_value=httpx.Response(
                200,
                json={"message": {"content": "hello there"}},
            )
        )
        out = llm.chat([{"role": "user", "content": "hi"}])
    assert out["content"] == "hello there"
    assert out["tool_calls"] == []


# ---------------------------------------------------------------------------
# embed
# ---------------------------------------------------------------------------

def test_embed_returns_vectors(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    with respx.mock:
        respx.post("http://127.0.0.1:11434/api/embeddings").mock(
            return_value=httpx.Response(200, json={"embedding": [0.1, 0.2, 0.3]})
        )
        result = llm.embed(["hello"])
    assert result == [[0.1, 0.2, 0.3]]


# ---------------------------------------------------------------------------
# health
# ---------------------------------------------------------------------------

def test_health_ok(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    monkeypatch.setenv("WILLIAMOS_LLM_MODEL", "qwen2.5:7b-instruct")
    with respx.mock:
        respx.get("http://127.0.0.1:11434/api/tags").mock(
            return_value=httpx.Response(
                200,
                json={
                    "models": [
                        {"name": "qwen2.5:7b-instruct"},
                        {"name": "nomic-embed-text"},
                    ]
                },
            )
        )
        result = llm.health()
    assert result["ok"] is True
    assert result["model"] == "qwen2.5:7b-instruct"
    assert result["runtime"] == "ollama"
    assert result["runtime_label"] == "Ollama"
    assert result["fallback"] is False
    assert result["policy"] == "explicit-runtime-only"


def test_health_model_missing(monkeypatch):
    """ok=False when configured model is not in the tags list."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    monkeypatch.setenv("WILLIAMOS_LLM_MODEL", "qwen2.5:7b-instruct")
    with respx.mock:
        respx.get("http://127.0.0.1:11434/api/tags").mock(
            return_value=httpx.Response(
                200,
                json={"models": [{"name": "some-other-model"}]},
            )
        )
        result = llm.health()
    assert result["ok"] is False
    assert "model" in result


def test_health_server_error(monkeypatch):
    """ok=False on HTTP error from /api/tags."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    with respx.mock:
        respx.get("http://127.0.0.1:11434/api/tags").mock(
            return_value=httpx.Response(500, text="internal error")
        )
        result = llm.health()
    assert result["ok"] is False


def test_runtime_registry_defaults_to_ollama(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")

    rows = llm.registry(probe=False)
    selected = [row for row in rows if row["selected"]]

    assert [row["id"] for row in rows] == ["ollama", "lmstudio", "llama_server"]
    assert selected[0]["id"] == "ollama"
    assert all(row["fallback"] is False for row in rows)
    assert all(row["auto_switch"] is False for row in rows)


def test_unknown_runtime_is_not_silently_replaced(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_RUNTIME", "cloud")

    result = llm.health()

    assert result["ok"] is False
    assert result["selected_runtime"] == "cloud"
    assert result["selected_known"] is False
    assert result["fallback"] is False
    assert "Unknown local model runtime" in result["detail"]


def test_runtime_status_probes_local_candidates(monkeypatch):
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")
    monkeypatch.setenv("WILLIAMOS_LLM_MODEL", "qwen2.5:7b-instruct")

    with respx.mock:
        respx.get("http://127.0.0.1:11434/api/tags").mock(
            return_value=httpx.Response(
                200,
                json={"models": [{"name": "qwen2.5:7b-instruct"}]},
            )
        )
        respx.get("http://127.0.0.1:1234/v1/models").mock(
            return_value=httpx.Response(
                200,
                json={"data": [{"id": "qwen2.5:7b-instruct"}]},
            )
        )
        respx.get("http://127.0.0.1:8080/health").mock(
            return_value=httpx.Response(200, json={"status": "ok"})
        )
        respx.get("http://127.0.0.1:8080/v1/models").mock(
            return_value=httpx.Response(
                200,
                json={"data": [{"id": "qwen2.5:7b-instruct"}]},
            )
        )

        result = llm.runtime_status()

    rows = {row["id"]: row for row in result["registry"]}
    assert result["selected"] == "ollama"
    assert rows["ollama"]["health"]["ok"] is True
    assert rows["lmstudio"]["health"]["ok"] is True
    assert rows["llama_server"]["health"]["ok"] is True
    assert rows["lmstudio"]["selected"] is False
    assert rows["llama_server"]["selected"] is False


# ---------------------------------------------------------------------------
# stream_chat
# ---------------------------------------------------------------------------

def test_stream_chat_yields_deltas_then_done(monkeypatch):
    """stream_chat yields delta events for content chunks then a final done event
    with accumulated content and normalized tool_calls."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")

    # NDJSON lines the fake Ollama would return
    ndjson_lines = [
        json.dumps({"message": {"content": "Hello"}, "done": False}),
        json.dumps({"message": {"content": " world"}, "done": False}),
        json.dumps({
            "message": {
                "content": "",
                "tool_calls": [
                    {"function": {"name": "backup-status", "arguments": {"disk": "/dev/sda"}}}
                ],
            },
            "done": True,
        }),
    ]

    # Build a fake context manager whose iter_lines() yields our NDJSON lines
    class FakeResponse:
        def raise_for_status(self):
            pass

        def iter_lines(self):
            yield from ndjson_lines

    class FakeStream:
        def __enter__(self):
            return FakeResponse()

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: FakeStream())

    events = list(llm.stream_chat(
        [{"role": "user", "content": "backup ok?"}],
        tools=[{"type": "function", "function": {"name": "backup-status"}}],
    ))

    # Should have two delta events then one done
    delta_events = [e for e in events if e["type"] == "delta"]
    done_events  = [e for e in events if e["type"] == "done"]

    assert len(delta_events) == 2
    assert delta_events[0]["text"] == "Hello"
    assert delta_events[1]["text"] == " world"

    assert len(done_events) == 1
    done = done_events[0]
    assert done["content"] == "Hello world"
    assert done["tool_calls"] == [{"name": "backup-status", "arguments": {"disk": "/dev/sda"}}]
    assert "error" not in done


def test_stream_chat_yields_done_with_error_on_exception(monkeypatch):
    """When the HTTP call raises, stream_chat yields a done event with an error field."""
    monkeypatch.setenv("WILLIAMOS_LLM_HOST", "http://127.0.0.1:11434")

    class BoomStream:
        def __enter__(self):
            raise ConnectionError("refused")

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(httpx, "stream", lambda *a, **kw: BoomStream())

    events = list(llm.stream_chat([{"role": "user", "content": "hi"}]))

    assert len(events) == 1
    ev = events[0]
    assert ev["type"] == "done"
    assert ev["content"] == ""
    assert ev["tool_calls"] == []
    assert "refused" in ev["error"]
