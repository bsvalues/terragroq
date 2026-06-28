"""Local model runtime adapters for WilliamOS Co-Pilot.

Environment:
  WILLIAMOS_LLM_RUNTIME  Runtime id: ollama, lmstudio, llama_server (default: ollama)
  WILLIAMOS_LLM_HOST     Active runtime host override
  WILLIAMOS_LLM_MODEL    Chat model name (default: qwen2.5:14b-instruct-q4_K_M)
  WILLIAMOS_EMBED_MODEL  Embed model name (default: nomic-embed-text)
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Any, Iterator, Protocol

import httpx

DEFAULT_RUNTIME = "ollama"
DEFAULT_MODEL = "qwen2.5:14b-instruct-q4_K_M"
DEFAULT_EMBED_MODEL = "nomic-embed-text"
LOCAL_SOURCE = "local"


class ModelRuntimeAdapter(Protocol):
    """Model runtime interface. Implementations must not silently fallback."""

    runtime_id: str
    label: str
    protocol: str
    host: str
    model: str
    embed_model: str

    def health_check(self) -> dict[str, Any]:
        """Return runtime health. Must not raise on failure."""
        ...

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict[str, Any]:
        """Return a non-streaming model response."""
        ...

    def stream_chat(self, messages: list[dict], tools: list[dict] | None = None) -> Iterator[dict]:
        """Yield streaming model events."""
        ...

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return embedding vectors."""
        ...

    def evidence(self) -> dict[str, Any]:
        """Return runtime metadata for evidence/history records."""
        ...


def _selected_runtime_id() -> str:
    return os.environ.get("WILLIAMOS_LLM_RUNTIME", DEFAULT_RUNTIME).strip().lower() or DEFAULT_RUNTIME


def _model() -> str:
    # 14B is the production default accepted for governance routing reliability.
    # Operators can still set WILLIAMOS_LLM_MODEL=qwen2.5:7b-instruct for lighter dev use.
    return os.environ.get("WILLIAMOS_LLM_MODEL", DEFAULT_MODEL)


def _embed_model() -> str:
    return os.environ.get("WILLIAMOS_EMBED_MODEL", DEFAULT_EMBED_MODEL)


def _timeout() -> float:
    return float(os.environ.get("WILLIAMOS_LLM_TIMEOUT", "300"))


def _probe_timeout() -> float:
    return float(os.environ.get("WILLIAMOS_LLM_PROBE_TIMEOUT", "2"))


def _env_host(runtime_id: str, default: str) -> str:
    if runtime_id == _selected_runtime_id():
        return os.environ.get("WILLIAMOS_LLM_HOST", default).rstrip("/")
    key = {
        "ollama": "WILLIAMOS_OLLAMA_HOST",
        "lmstudio": "WILLIAMOS_LMSTUDIO_HOST",
        "llama_server": "WILLIAMOS_LLAMA_SERVER_HOST",
    }.get(runtime_id)
    return os.environ.get(key, default).rstrip("/") if key else default.rstrip("/")


def _normalize_tool_calls(raw: list[dict]) -> list[dict[str, Any]]:
    """Convert Ollama/OpenAI tool calls to ``[{"name": str, "arguments": dict}]``."""
    result = []
    for tc in raw:
        fn = tc.get("function", {})
        name = fn.get("name", "")
        args = fn.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        result.append({"name": name, "arguments": args})
    return result


@dataclass
class BaseAdapter:
    runtime_id: str
    label: str
    protocol: str
    host: str
    model: str
    embed_model: str

    def evidence(self) -> dict[str, Any]:
        return {
            "runtime": self.runtime_id,
            "runtime_label": self.label,
            "model": self.model,
            "host": self.host,
            "source": LOCAL_SOURCE,
            "fallback": False,
        }


class OllamaAdapter(BaseAdapter):
    def health_check(self) -> dict[str, Any]:
        try:
            resp = httpx.get(f"{self.host}/api/tags", timeout=10.0)
            resp.raise_for_status()
            body = resp.json()
            names = sorted(m["name"] for m in body.get("models", []) if m.get("name"))
            ok = self.model in names
            detail = "model available" if ok else f"model '{self.model}' not found in {names}"
            return self._health(ok=ok, detail=detail, models=names)
        except Exception as exc:
            return self._health(ok=False, detail=str(exc), models=[])

    def _health(self, ok: bool, detail: str, models: list[str]) -> dict[str, Any]:
        return {
            "ok": ok,
            "runtime": self.runtime_id,
            "runtime_label": self.label,
            "runtime_host": self.host,
            "source": LOCAL_SOURCE,
            "fallback": False,
            "model": self.model,
            "embed_model": self.embed_model,
            "detail": detail,
            "models": models,
        }

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        resp = httpx.post(f"{self.host}/api/chat", json=payload, timeout=_timeout())
        resp.raise_for_status()
        body = resp.json()

        message = body.get("message", {})
        return {
            "content": message.get("content", ""),
            "tool_calls": _normalize_tool_calls(message.get("tool_calls", [])),
            "runtime": self.evidence(),
        }

    def stream_chat(self, messages: list[dict], tools: list[dict] | None = None) -> Iterator[dict]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        accumulated_content = ""
        raw_tool_calls: list[dict] = []

        try:
            with httpx.stream("POST", f"{self.host}/api/chat", json=payload, timeout=_timeout()) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    message = chunk.get("message", {})
                    delta: str = message.get("content", "") or ""
                    if delta:
                        accumulated_content += delta
                        yield {"type": "delta", "text": delta}

                    tc_list = message.get("tool_calls", [])
                    if tc_list:
                        raw_tool_calls.extend(tc_list)

                    if chunk.get("done"):
                        break

        except Exception as exc:
            yield {
                "type": "done",
                "content": "",
                "tool_calls": [],
                "runtime": self.evidence(),
                "error": str(exc)[:200],
            }
            return

        yield {
            "type": "done",
            "content": accumulated_content,
            "tool_calls": _normalize_tool_calls(raw_tool_calls),
            "runtime": self.evidence(),
        }

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            resp = httpx.post(
                f"{self.host}/api/embeddings",
                json={"model": self.embed_model, "prompt": text},
                timeout=_timeout(),
            )
            resp.raise_for_status()
            vectors.append(resp.json()["embedding"])
        return vectors


class OpenAICompatibleAdapter(BaseAdapter):
    health_path = "/models"

    def health_check(self) -> dict[str, Any]:
        try:
            resp = httpx.get(f"{self.host}{self.health_path}", timeout=_probe_timeout())
            resp.raise_for_status()
            body = resp.json()
            names = _openai_model_names(body)
            if names:
                ok = self.model in names
                detail = "model available" if ok else f"model '{self.model}' not found in {names}"
            else:
                ok = True
                detail = "runtime reachable; model list empty or unavailable"
            return self._health(ok=ok, detail=detail, models=names)
        except Exception as exc:
            return self._health(ok=False, detail=str(exc), models=[])

    def _health(self, ok: bool, detail: str, models: list[str]) -> dict[str, Any]:
        return {
            "ok": ok,
            "runtime": self.runtime_id,
            "runtime_label": self.label,
            "runtime_host": self.host,
            "source": LOCAL_SOURCE,
            "fallback": False,
            "model": self.model,
            "embed_model": self.embed_model,
            "detail": detail,
            "models": models,
        }

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        resp = httpx.post(f"{self.host}/chat/completions", json=payload, timeout=_timeout())
        resp.raise_for_status()
        body = resp.json()
        message = (body.get("choices") or [{}])[0].get("message", {})
        return {
            "content": message.get("content", "") or "",
            "tool_calls": _normalize_tool_calls(message.get("tool_calls", [])),
            "runtime": self.evidence(),
        }

    def stream_chat(self, messages: list[dict], tools: list[dict] | None = None) -> Iterator[dict]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        accumulated_content = ""
        raw_tool_calls: list[dict] = []
        try:
            with httpx.stream("POST", f"{self.host}/chat/completions", json=payload, timeout=_timeout()) as r:
                r.raise_for_status()
                for line in r.iter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    payload_text = line[5:].strip()
                    if payload_text == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload_text)
                    except json.JSONDecodeError:
                        continue
                    delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                    text = delta.get("content") or ""
                    if text:
                        accumulated_content += text
                        yield {"type": "delta", "text": text}
                    raw_tool_calls.extend(delta.get("tool_calls", []) or [])
        except Exception as exc:
            yield {
                "type": "done",
                "content": "",
                "tool_calls": [],
                "runtime": self.evidence(),
                "error": str(exc)[:200],
            }
            return

        yield {
            "type": "done",
            "content": accumulated_content,
            "tool_calls": _normalize_tool_calls(raw_tool_calls),
            "runtime": self.evidence(),
        }

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = httpx.post(
            f"{self.host}/embeddings",
            json={"model": self.embed_model, "input": texts},
            timeout=_timeout(),
        )
        resp.raise_for_status()
        body = resp.json()
        return [item["embedding"] for item in body.get("data", [])]


class LlamaServerAdapter(OpenAICompatibleAdapter):
    def health_check(self) -> dict[str, Any]:
        try:
            resp = httpx.get(f"{self.host}/health", timeout=_probe_timeout())
            resp.raise_for_status()
            health_body = resp.json() if resp.content else {}
            health_detail = health_body.get("status", "ok") if isinstance(health_body, dict) else "ok"
        except Exception as exc:
            return self._health(ok=False, detail=str(exc), models=[])

        models = self._models()
        if models:
            ok = self.model in models
            detail = "model available" if ok else f"health={health_detail}; model '{self.model}' not found in {models}"
        else:
            ok = True
            detail = f"health={health_detail}; model list unavailable"
        return self._health(ok=ok, detail=detail, models=models)

    def _models(self) -> list[str]:
        try:
            resp = httpx.get(f"{self.host}/v1/models", timeout=_probe_timeout())
            resp.raise_for_status()
            return _openai_model_names(resp.json())
        except Exception:
            return []

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict[str, Any]:
        self._ensure_v1_host()
        return super().chat(messages, tools=tools)

    def stream_chat(self, messages: list[dict], tools: list[dict] | None = None) -> Iterator[dict]:
        self._ensure_v1_host()
        yield from super().stream_chat(messages, tools=tools)

    def embed(self, texts: list[str]) -> list[list[float]]:
        self._ensure_v1_host()
        return super().embed(texts)

    def _ensure_v1_host(self) -> None:
        if not self.host.endswith("/v1"):
            self.host = f"{self.host}/v1"


def _openai_model_names(body: dict[str, Any]) -> list[str]:
    names = []
    for item in body.get("data", []):
        model_id = item.get("id") or item.get("name")
        if model_id:
            names.append(model_id)
    return sorted(names)


def _adapter_specs() -> list[dict[str, str]]:
    return [
        {
            "id": "ollama",
            "label": "Ollama",
            "protocol": "ollama",
            "host": _env_host("ollama", "http://127.0.0.1:11434"),
            "state": "default",
        },
        {
            "id": "lmstudio",
            "label": "LM Studio",
            "protocol": "openai-compatible",
            "host": _env_host("lmstudio", "http://127.0.0.1:1234/v1"),
            "state": "candidate",
        },
        {
            "id": "llama_server",
            "label": "llama-server",
            "protocol": "openai-compatible",
            "host": _env_host("llama_server", "http://127.0.0.1:8080"),
            "state": "candidate",
        },
    ]


def _build_adapter(runtime_id: str) -> ModelRuntimeAdapter:
    specs = {spec["id"]: spec for spec in _adapter_specs()}
    if runtime_id not in specs:
        raise ValueError(f"Unknown local model runtime '{runtime_id}'. Expected one of: {', '.join(sorted(specs))}")

    spec = specs[runtime_id]
    kwargs = {
        "runtime_id": spec["id"],
        "label": spec["label"],
        "protocol": spec["protocol"],
        "host": spec["host"],
        "model": _model(),
        "embed_model": _embed_model(),
    }
    if runtime_id == "ollama":
        return OllamaAdapter(**kwargs)
    if runtime_id == "llama_server":
        return LlamaServerAdapter(**kwargs)
    return OpenAICompatibleAdapter(**kwargs)


def selected_adapter() -> ModelRuntimeAdapter:
    """Return the explicitly selected adapter. Default is Ollama."""
    return _build_adapter(_selected_runtime_id())


def registry(probe: bool = False) -> list[dict[str, Any]]:
    """Return known local runtimes. Probe candidates only when requested."""
    selected = _selected_runtime_id()
    rows = []
    for spec in _adapter_specs():
        row: dict[str, Any] = {
            "id": spec["id"],
            "label": spec["label"],
            "protocol": spec["protocol"],
            "host": spec["host"],
            "source": LOCAL_SOURCE,
            "state": spec["state"],
            "selected": spec["id"] == selected,
            "fallback": False,
            "auto_switch": False,
        }
        if probe:
            try:
                adapter = _build_adapter(spec["id"])
                row["health"] = adapter.health_check()
            except Exception as exc:
                row["health"] = {"ok": False, "detail": str(exc)}
        rows.append(row)
    return rows


def runtime_status() -> dict[str, Any]:
    selected = _selected_runtime_id()
    try:
        adapter = selected_adapter()
        active_health = adapter.health_check()
        selected_known = True
    except Exception as exc:
        active_health = {
            "ok": False,
            "runtime": selected,
            "runtime_label": selected,
            "runtime_host": "",
            "source": LOCAL_SOURCE,
            "fallback": False,
            "model": _model(),
            "embed_model": _embed_model(),
            "detail": str(exc),
            "models": [],
        }
        selected_known = False

    return {
        "selected": selected,
        "selected_known": selected_known,
        "active": active_health,
        "registry": registry(probe=True),
        "fallback": False,
        "policy": "explicit-runtime-only",
    }


def runtime_evidence() -> dict[str, Any]:
    return selected_adapter().evidence()


def chat(messages: list[dict], tools: list[dict] | None = None) -> dict[str, Any]:
    return selected_adapter().chat(messages, tools=tools)


def stream_chat(messages: list[dict], tools: list[dict] | None = None) -> Iterator[dict]:
    yield from selected_adapter().stream_chat(messages, tools=tools)


def embed(texts: list[str]) -> list[list[float]]:
    return selected_adapter().embed(texts)


def health() -> dict[str, Any]:
    """Return active runtime health with registry visibility. Never falls back."""
    selected = _selected_runtime_id()
    try:
        adapter = selected_adapter()
        active = adapter.health_check()
        selected_known = True
    except Exception as exc:
        active = {
            "ok": False,
            "runtime": selected,
            "runtime_label": selected,
            "runtime_host": "",
            "source": LOCAL_SOURCE,
            "fallback": False,
            "model": _model(),
            "embed_model": _embed_model(),
            "detail": str(exc),
            "models": [],
        }
        selected_known = False
    active["selected_runtime"] = selected
    active["selected_known"] = selected_known
    active["policy"] = "explicit-runtime-only"
    active["registry"] = registry(probe=False)
    return active
