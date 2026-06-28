---
type: plan
feature: model-runtime-adapter
status: phase5e-implemented
generated: 2026-06-24
tags:
  - devkit
  - model
  - runtime
  - adapter
---

# Model Runtime Adapter Plan

## Purpose

Define how WilliamOS can survive Ollama instability, hardware changes, or model
availability issues by supporting multiple local model runtimes — without hiding
fallback behavior from the operator.

**Hard rule:**
> WilliamOS must never silently fall back to a cloud or external runtime.
> Runtime selection must be visible to the operator.
> The Evidence rail and History must record which runtime answered every query.

---

## Current Runtime (Baseline)

| Property | Value |
|----------|-------|
| Runtime | Ollama |
| API | `http://127.0.0.1:11434` |
| Primary model | `qwen2.5:14b-instruct-q4_K_M` |
| Embed model | `nomic-embed-text` |
| Timeout | 300 seconds |
| Client | `control-center/backend/copilot/llm.py` |

Ollama is managed outside WilliamOS. WilliamOS treats it as an external local
service — it can check health, report status, and degrade gracefully when Ollama
is offline, but it does not manage the Ollama process.

---

## Planned Runtime Adapters

### Adapter 1 — Ollama (Current Default)

| Property | Value |
|----------|-------|
| Status | Implemented |
| URL | `http://127.0.0.1:11434` |
| Protocol | Ollama REST API (`/api/generate`, `/api/chat`, `/api/tags`, `/api/embeddings`) |
| Health check | `GET /api/tags` |
| Fallback | None (current default) |
| Visibility | Model online/offline shown in status strip |

No adapter code change needed for Ollama — it is the current runtime.

---

### Adapter 2 — LM Studio (Desktop Fallback)

| Property | Value |
|----------|-------|
| Status | Planned |
| URL | `http://localhost:1234/v1` |
| Protocol | OpenAI-compatible REST API |
| Health check | `GET /v1/models` |
| Trigger | Ollama offline AND operator has configured LM Studio adapter |

LM Studio is a desktop application for running GGUF models locally with a GUI.
It exposes an OpenAI-compatible API.

**Adapter requirements:**
- Config key: `model_runtime = "lmstudio"`
- Adapter class: `LMStudioAdapter` in `llm.py`
- Override `generate()` and `embed()` methods to call the OpenAI-compatible endpoint
- Health check polls `GET /v1/models` to confirm service is running
- Fallback is never automatic — operator must explicitly set the config

**Operator note:** LM Studio does not provide the same model catalog as Ollama.
Embedding models may require separate configuration. The embed model must be
explicitly loaded in LM Studio before WilliamOS RAG will work.

---

### Adapter 3 — llama.cpp / llama-server (Pinned Production Runtime Candidate)

| Property | Value |
|----------|-------|
| Status | Planned |
| URL | `http://127.0.0.1:8080` (default llama-server port) |
| Protocol | llama-server REST API (OpenAI-compatible subset) |
| Health check | `GET /health` |
| Trigger | Operator has configured llama-server adapter |

llama.cpp's `llama-server` is a lightweight, cross-platform model server that
can be compiled with specific hardware optimizations. It is the best candidate for
a pinned production runtime when Ollama's update behavior is a concern.

**Adapter requirements:**
- Config key: `model_runtime = "llama_server"`
- Adapter class: `LlamaServerAdapter` in `llm.py`
- Separate embed model configuration (llama-server can serve embedding models)
- Health check: `GET /health` returns `{"status":"ok"}`
- Server launch command (not managed by WilliamOS):
  ```bash
  ./llama-server -m <model.gguf> -c 4096 --host 127.0.0.1 --port 8080
  ```

**Why this matters:** If Ollama auto-updates and breaks compatibility, llama-server
at a pinned version remains stable. This is the recommended path for production
hardening when model stability is a priority.

---

### Adapter 4 — Hugging Face TGI (Future Local/Server Runtime)

| Property | Value |
|----------|-------|
| Status | Future (post-v1.3.0) |
| URL | `http://127.0.0.1:8080` |
| Protocol | TGI REST API |
| Trigger | Explicit operator configuration |

Text Generation Inference (TGI) is a high-throughput inference server. It is
a future option for dedicated hardware or multi-user scenarios. Not a priority
for the current single-operator local system.

---

### Adapter 5 — vLLM (Future GPU/Server Runtime)

| Property | Value |
|----------|-------|
| Status | Future (post-v1.3.0) |
| URL | `http://127.0.0.1:8000/v1` |
| Protocol | OpenAI-compatible |
| Trigger | Explicit operator configuration |

vLLM is a production-grade LLM inference engine for dedicated GPU servers. Not
applicable for the current local-first laptop/desktop deployment. Document for
future server-mode operation.

---

### Adapter 6 — Cloud APIs (Disabled by Default)

| Property | Value |
|----------|-------|
| Status | Explicitly disabled |
| Providers | OpenAI, Anthropic, etc. |
| Default | Never active |
| Trigger | Explicit operator authorization required |

**Policy:**
> Cloud APIs must never be enabled automatically. Runtime fallback to a cloud
> API is prohibited. If WilliamOS detects that a local runtime is offline and
> cloud APIs are disabled, it must present a "model offline" state — not silently
> route to the cloud.

Any future cloud adapter must:
1. Require explicit config: `model_runtime = "cloud"` (or provider name)
2. Display a prominent "CLOUD RUNTIME ACTIVE" notice in the status strip
3. Record the runtime used in every Evidence and History entry
4. Require operator confirmation before the first cloud request of each session

---

## Adapter Architecture

The adapter pattern in `llm.py` should follow this interface:

```python
class ModelRuntimeAdapter:
    """Base interface for model runtime adapters."""

    def health_check(self) -> dict:
        """Return runtime health. Must not raise on failure."""
        ...

    def generate(self, prompt: str, tools: list, **kwargs) -> Generator:
        """Stream token events from the model."""
        ...

    def embed(self, text: str) -> list[float]:
        """Return embedding vector for text."""
        ...

    @property
    def runtime_name(self) -> str:
        """Human-readable runtime name for Evidence/History recording."""
        ...
```

The active adapter must be recorded in every Evidence entry:
```json
{
  "runtime": "ollama",
  "model": "qwen2.5:14b-instruct-q4_K_M",
  ...
}
```

---

## Runtime Visibility Requirements

Every model response visible to the operator must carry:
- Runtime name (e.g., "Ollama")
- Model name (e.g., "qwen2.5:14b-instruct-q4_K_M")
- Response source (local or — if cloud ever enabled — cloud provider name)

The status strip must always show the currently active runtime, not just
online/offline state. If the runtime changes during a session, the strip
must update immediately.

---

## Implementation Order

1. **v1.3.1 baseline:** Ollama is the production default and remains local-only.
2. **Phase 5E implemented:** `llm.py` exposes an explicit runtime registry,
   Ollama adapter, LM Studio candidate, and llama-server candidate. Selection is
   controlled by `WILLIAMOS_LLM_RUNTIME`; no runtime is selected as fallback.
3. **Future:** Runtime config key in system settings (not env var).
4. **Future:** TGI, vLLM adapters for server deployments.
5. **Never automatic:** Cloud API fallback.

## Phase 5E Implementation Note

`WO-WILLIAMOS-PHASE5E-RUNTIME-ADAPTER-001` implemented the local runtime
adapter boundary:

- Default runtime: `ollama`
- Candidate runtime: `lmstudio`
- Candidate runtime: `llama_server`
- Selection policy: explicit runtime only
- Fallback policy: no fallback and no automatic runtime switching
- Evidence: `/api/copilot/health`, `/api/copilot/runtime`, chat stream runtime
  events, and persisted assistant-message metadata include the selected runtime
  and model.

Phase 6 remains blocked.
