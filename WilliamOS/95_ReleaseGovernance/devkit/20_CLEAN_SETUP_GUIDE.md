---
type: setup-guide
version_target: v1.3.0
generated: 2026-06-24
tags:
  - devkit
  - setup
  - install
---

# WilliamOS Clean Setup Guide — v1.3.0

Use this guide to set up a fresh WilliamOS environment from a clean clone or
after a restore from backup.

All commands run from the repo root unless noted.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | 3.12 recommended |
| Node.js | 18+ | LTS recommended |
| npm | 9+ | Comes with Node |
| Ollama | 0.3+ | For model-backed chat/RAG |
| Git | Any | For snapshots and governance |

---

## Step 1 — Python Setup

```bash
# Create a virtual environment (recommended)
python -m venv .venv

# Activate (macOS/Linux)
source .venv/bin/activate

# Activate (Windows)
.venv\Scripts\activate

# Install backend dependencies
pip install -r requirements.txt

# Install search/retrieval dependencies (optional — needed for RAG)
pip install -r requirements-search.txt
```

If you see permission errors on Windows, run the terminal as Administrator or
use `--user` flag:
```bash
pip install -r requirements.txt --user
```

---

## Step 2 — Node / npm Setup

```bash
# Install frontend dependencies
cd control-center/frontend
npm install

# Build the frontend (required before first launch)
npm run build

# Return to repo root
cd ../..
```

The built files land in `control-center/frontend/dist/`. FastAPI serves them
statically — no Node process runs at runtime.

---

## Step 3 — Ollama Install

**macOS:**
```bash
brew install ollama
# Or download from https://ollama.com
```

**Windows / Linux:**
Download the installer from https://ollama.com and follow the platform guide.

After install, verify Ollama is running:
```bash
ollama list
curl http://127.0.0.1:11434/api/tags
```

Expected response: JSON with installed models (may be empty on a fresh install).

---

## Step 4 — Pull Required Models

```bash
# Primary chat model (~9 GB, Q4 quantized 14B)
ollama pull qwen2.5:14b-instruct-q4_K_M

# Embedding model for semantic search and RAG (~274 MB)
ollama pull nomic-embed-text
```

Check that both models are present:
```bash
ollama list
```

Expected output includes:
```
qwen2.5:14b-instruct-q4_K_M    ...
nomic-embed-text                ...
```

---

## Step 5 — Model Health Check

```bash
# Verify Ollama API is reachable
curl http://127.0.0.1:11434/api/tags

# Quick inference test (optional)
curl http://127.0.0.1:11434/api/generate \
  -d '{"model":"qwen2.5:14b-instruct-q4_K_M","prompt":"Hello","stream":false}'
```

If Ollama is not running, start it:
```bash
ollama serve
```

Or use the Ollama desktop app (starts the service automatically).

---

## Step 6 — Initialize the Copilot System

```bash
python scripts/setup_copilot.py
```

This script:
- Creates `copilot.db` (SQLite, memory + session storage)
- Creates the semantic search index directory
- Verifies the vault structure
- Reports model availability

On a clean install, the semantic index starts empty. Populate it with:
```bash
python scripts/william.py semantic-index
```

---

## Step 7 — Optional Fallback Runtimes

If Ollama is unavailable or you want an alternative model runtime, see
`60_MODEL_RUNTIME_ADAPTER_PLAN.md` for the full multi-runtime adapter plan.

**LM Studio (desktop GUI fallback):**
- Install from https://lmstudio.ai
- Load a compatible GGUF model
- Start the local server (default: `http://localhost:1234`)
- WilliamOS does not automatically use LM Studio; adapter configuration is required

**llama.cpp / llama-server (pinned production candidate):**
- Compile from https://github.com/ggerganov/llama.cpp
- Run: `./server -m <model.gguf> -c 4096 --host 127.0.0.1 --port 8080`
- WilliamOS does not automatically use llama-server; adapter configuration is required

**Cloud APIs:**
Cloud APIs (OpenAI, Anthropic, etc.) are disabled by default and require explicit
operator authorization. WilliamOS must never silently fall back to a cloud runtime.

---

## Step 8 — Degraded Mode Note

> **If Ollama is offline, WilliamOS core remains fully usable.**
>
> All governance commands, vault operations, snapshots, backups, synthesis,
> inbox processing, briefings, and shell commands continue to work.
>
> Model-backed chat, RAG-grounded answers, and semantic search degrade gracefully:
> - Chat returns an offline notice rather than an empty response
> - RAG citations are unavailable until the model returns
> - Semantic search falls back to keyword search if the embed model is unavailable
>
> No data is lost during degraded operation. Restore model service and resume normally.

---

## Step 9 — First Launch

```bash
# Run validation before first launch
python scripts/william.py production-readiness

# Launch (opens browser)
python scripts/william.py control-center
```

On a healthy first launch:
- Status strip shows model online or offline (both are acceptable starting states)
- Briefing card renders
- Command panel is available
- No errors in the terminal

If `production-readiness` fails, see `30_VALIDATION_GATES.md` for resolution steps.

---

## Local-Only Ignored Paths

The following paths are git-ignored and will not appear in `git status`:
```
copilot.db
copilot.db-shm
copilot.db-wal
WilliamOS/110_ControlCenter/generated/runtime/control-center.json
control-center/frontend/node_modules/
control-center/frontend/dist/
__pycache__/
.pytest_cache/
.venv/
```

These are local runtime state files. They are not version controlled and do not
need to be included in backups (though the backup process may optionally archive them).

---

## Quick Reference — Setup Commands

```bash
# Python
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-search.txt

# Node / frontend
cd control-center/frontend && npm install && npm run build && cd ../..

# Ollama models
ollama pull qwen2.5:14b-instruct-q4_K_M
ollama pull nomic-embed-text

# Init copilot system
python scripts/setup_copilot.py

# Validate
python scripts/william.py production-readiness

# Launch
python scripts/william.py control-center
```
