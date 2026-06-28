---
type: plan
feature: containerization
status: planned
generated: 2026-06-24
tags:
  - devkit
  - docker
  - containers
---

# Containerization Plan

## Recommended Posture

> Containerize gates, builds, backend service options, and future worker sandboxes.
> Do not containerize the daily desktop/operator experience.

WilliamOS is a local-first personal operator system. Its core value comes from
direct access to the local filesystem, local model runtime, and the operator's
personal vault. Putting the daily operator experience behind a container boundary
adds friction without benefit.

Containers belong at the edges: reproducible builds, isolated test runs, sandboxed
external workers, and optional backend-as-service for future multi-device scenarios.

---

## Non-Goals

The following are explicitly out of scope for any containerization work:

| Non-Goal | Reason |
|----------|--------|
| Containerized daily tray app | Breaks local filesystem access and model runtime |
| Replacing the local launcher | `python scripts/william.py control-center` is the operator experience |
| Kubernetes | Overkill for a single-operator local system |
| Secrets in container images | WilliamOS has no secrets; do not create them |
| Cloud deployment of core | WilliamOS is local-first; cloud deployment is out of scope |
| Phase 6 autonomy via containers | Phase 6 remains blocked; containers do not unlock it |
| Containerized Ollama | Ollama manages its own process; WilliamOS treats it as a local service |

---

## Container Candidates

### 1 — Backend Test Runner

**Purpose:** Reproducible, isolated Python test execution for CI and future
contributor environments.

**What it contains:**
- Python 3.12 image
- `requirements.txt` dependencies
- `control-center/backend/` source
- `scripts/` (read-only)
- Mock vault fixtures for tests that need vault paths

**What it does NOT contain:**
- The live vault (`WilliamOS/`)
- `copilot.db`
- Ollama models or Ollama itself (tests mock the LLM client)

**Command:**
```bash
docker build -f Dockerfile.test-backend -t williamos-test-backend .
docker run --rm williamos-test-backend \
  python -m pytest control-center/backend/tests -q
```

**Gate integration:** Future CI/CD pipeline runs this container for every PR.

---

### 2 — Frontend Build Runner

**Purpose:** Reproducible Node.js environment for the React frontend build.

**What it contains:**
- Node 20 LTS image
- `control-center/frontend/` source
- `npm install` pre-run layer

**Output:** Mounts `control-center/frontend/dist/` into the host filesystem.

**Command:**
```bash
docker build -f Dockerfile.build-frontend -t williamos-build-frontend .
docker run --rm \
  -v $(pwd)/control-center/frontend/dist:/app/dist \
  williamos-build-frontend \
  npm run build
```

**Gate integration:** Ensures the frontend build is reproducible across machines
and OS versions.

---

### 3 — Release Gate Runner

**Purpose:** Run the full validation gate suite in an isolated, reproducible environment.

**What it contains:**
- Backend test runner (above)
- Frontend build runner (above)
- Python 3.12 + requirements
- Mock vault fixtures

**What it checks:**
```bash
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
```

**Note:** Runtime smoke and production-readiness are not run in the container —
they require the live vault and running backend. They remain operator-run checks
on the actual machine.

---

### 4 — Worker Sandbox (Future)

**Purpose:** When external workers are enabled, provide an isolated execution
environment to prevent unauthorized filesystem access.

**Design principles:**
- Mount only the allowed paths from the worker's `scope_policy.allowed_paths`
- Block all paths in `scope_policy.blocked_paths`
- Network access: none (local-only)
- Read-only vault mount by default
- Write mount only for approved output directories, and only for the proposal run
- Evidence capture: stdout/stderr piped to the WilliamOS evidence recorder

**When this is needed:** Only when an external worker's `proposal_execution.enabled`
is set to `true`. Currently, all external workers are disabled.

---

### 5 — Optional Backend Service (Future)

**Purpose:** For future multi-device or server scenarios, run the FastAPI backend
as a service container.

**What this enables:**
- Access WilliamOS Control Center from another device on the local network
- Separate backend lifecycle from the operator's desktop session

**Hard constraints:**
- Bind to `127.0.0.1` or local network only — never public internet
- Vault mounted from the host filesystem (not copied into the container)
- No cloud sync or remote push
- Ollama remains a separate process on the host (not containerized)
- All safety gates remain active inside the container

**Not for v1.3.0.** Document for future planning only.

---

### 6 — llama-server Runtime Container (Optional)

**Purpose:** Pin a specific llama.cpp version for model stability.

**What this enables:**
- Reproducible model runtime regardless of system llama.cpp installation
- Protection against Ollama auto-update behavior

**Hard constraints:**
- Model files (.gguf) mounted from the host — never baked into the image
- Bind to `127.0.0.1` only
- No internet access from the container

**Example:**
```bash
docker run --rm \
  -v /path/to/models:/models:ro \
  -p 127.0.0.1:8080:8080 \
  ghcr.io/ggerganov/llama.cpp:server \
  -m /models/qwen2.5-14b-instruct-q4_k_m.gguf \
  -c 4096 --host 0.0.0.0 --port 8080
```

---

## Implementation Order

1. **First:** Backend test runner container (enables reproducible gate checks).
2. **Second:** Frontend build runner container (enables reproducible builds).
3. **Third:** Release gate runner (combines 1+2 as a CI gate).
4. **Later:** Worker sandbox (only needed when external workers are enabled).
5. **Future:** Optional backend service container for multi-device use.
6. **Optional:** llama-server pinned runtime container.

No containers should be introduced until the v1.3.0 tag is created and the
daily operating routine is stable.
