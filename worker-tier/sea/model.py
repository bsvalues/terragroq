"""Minimal, dependency-free model client.

Speaks both Ollama's native `/api/chat` (with `format:"json"` constrained decoding) and the
OpenAI-compatible `/v1/chat/completions` (`response_format: json_object`). Temperature defaults
to 0 for determinism. `MockModelClient` drives the offline unit tests with scripted responses.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request


class ModelError(Exception):
    pass


class ModelClient:
    def __init__(self, base_url: str, model: str, api: str = "auto", api_key: str | None = None,
                 temperature: float = 0.0, timeout: int = 240, num_ctx: int | None = 8192):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.timeout = timeout
        # num_ctx caps the served context for Ollama. SEA does small, bounded structured edits, so a
        # modest window keeps the model's KV cache (and host RAM) small — no need for Hermes' 64K default.
        self.num_ctx = num_ctx
        if api == "auto":
            looks_ollama = ("/v1" not in self.base_url) and (
                self.base_url.endswith("/api") or ":11434" in self.base_url or ":11500" in self.base_url
            )
            api = "ollama" if looks_ollama else "openai"
        if api not in ("ollama", "openai"):
            raise ValueError(f"unknown api {api!r}")
        self.api = api

    def _post(self, path: str, payload: dict) -> dict:
        data = json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return json.load(r)
        except urllib.error.URLError as e:
            raise ModelError(f"model request to {self.base_url}{path} failed: {e}")

    def chat(self, system: str, user: str, json_mode: bool = False) -> str:
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        if self.api == "ollama":
            options: dict = {"temperature": self.temperature}
            if self.num_ctx:
                options["num_ctx"] = self.num_ctx
            payload: dict = {
                "model": self.model, "messages": messages, "stream": False,
                "options": options,
            }
            if json_mode:
                payload["format"] = "json"
            resp = self._post("/api/chat", payload)
            try:
                return resp["message"]["content"]
            except (KeyError, TypeError):
                raise ModelError(f"unexpected ollama response: {resp}")
        else:
            payload = {"model": self.model, "messages": messages, "temperature": self.temperature}
            if json_mode:
                payload["response_format"] = {"type": "json_object"}
            resp = self._post("/v1/chat/completions", payload)
            try:
                return resp["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError):
                raise ModelError(f"unexpected openai response: {resp}")


class MockModelClient:
    """Deterministic client for tests. `responses` is a list (consumed in order) or a callable
    (system, user, json_mode, call_index) -> str."""

    def __init__(self, responses):
        self._callable = callable(responses)
        self._responses = responses if self._callable else list(responses)
        self.calls: list[dict] = []

    def chat(self, system: str, user: str, json_mode: bool = False) -> str:
        self.calls.append({"system": system, "user": user, "json_mode": json_mode})
        if self._callable:
            return self._responses(system, user, json_mode, len(self.calls) - 1)
        if not self._responses:
            raise ModelError("MockModelClient ran out of scripted responses")
        return self._responses.pop(0)
