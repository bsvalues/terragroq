---
type: release-notes
status: ready-for-tag
generated: 2026-06-26 11:45 PDT
release: v1.3.1
baseline: 309d643
previous_release: v1.3.0
previous_tag_commit: 2c44ff2
tags:
  - release
  - governance
  - copilot
  - runtime
---

# WilliamOS v1.3.1 Release Governance - 2026-06-26

## Decision

v1.3.1 promotes the post-v1.3.0 runtime hardening patch to a local patch release.

Tag target before release-governance note:

```text
309d643187f180d3672406d21a77dd1e7bb77597
fix(copilot): auto-start Ollama and preserve 14B runtime default
```

v1.3.0 remains frozen at:

```text
2c44ff2a00bd28a312cd23b28a3011fa9261e20f
```

Phase 6 remains blocked. No push, merge, cloud fallback, external worker authority expansion, Docker, PWA, or Tauri implementation is included.

## Scope

Included:

- Auto-start Ollama when installed but not serving.
- Preserve `qwen2.5:14b-instruct-q4_K_M` as the production default chat model.
- Keep `qwen2.5:7b-instruct` available only by `WILLIAMOS_LLM_MODEL` override.
- Make `setup_copilot.py` start Ollama and pull required models.
- Make Control Center launch start Ollama before backend startup when local Ollama is installed.
- Report copilot health as informational OK instead of misleading FAIL when the informational check is healthy.

Not included:

- No Phase 6.
- No PWA/Tauri implementation.
- No Docker implementation.
- No cloud fallback.
- No new agent or worker authority.
- No v1.3.0 tag movement.

## Runtime Defaults

| Runtime item | Result |
|---|---|
| Production chat model | `qwen2.5:14b-instruct-q4_K_M` |
| Development override model | `qwen2.5:7b-instruct` via `WILLIAMOS_LLM_MODEL` only |
| Embed model | `nomic-embed-text:latest` |
| Local model health | OK |
| Cloud fallback | Not configured |

Final health snapshot:

```json
{"ok": true, "model": "qwen2.5:14b-instruct-q4_K_M", "detail": "model available"}
```

## Gate Results

Commands run on 2026-06-26:

```bash
git status --short
git rev-parse HEAD
git rev-parse v1.3.0
git tag -l v1.3.1
python -m pytest control-center/backend/tests -q
cd control-center/frontend && npm run build
python scripts/william.py runtime-smoke
python scripts/william.py production-readiness
```

Results:

| Check | Result |
|---|---|
| Candidate HEAD before release note | PASS, `309d643187f180d3672406d21a77dd1e7bb77597` |
| `v1.3.0` unchanged | PASS, `2c44ff2a00bd28a312cd23b28a3011fa9261e20f` |
| `v1.3.1` absent before tag | PASS |
| Backend tests | PASS, 158/158 |
| Frontend build | PASS |
| Runtime smoke | PASS, 28/28, 0 critical failures |
| Production readiness | PASS, 9/9 |
| Copilot health | INFO/OK, model available |

## Cold-Start Proof

Ollama was stopped locally, then `python scripts/setup_copilot.py` was run. Result:

- Ollama started.
- `qwen2.5:14b-instruct-q4_K_M` was pulled/restored.
- `nomic-embed-text` was pulled/restored.
- Setup completed successfully.

Ollama was stopped again, then `python scripts/william.py control-center --no-open` was launched. Result:

- Control Center startup brought Ollama online.
- `/api/copilot/health` returned OK.
- Health reported `qwen2.5:14b-instruct-q4_K_M`.

## Evidence Files

- `WilliamOS/105_RuntimeSmoke/data/smoke-2026-06-26.json`
- `WilliamOS/105_RuntimeSmoke/reports/Runtime Smoke - 2026-06-26.md`
- `WilliamOS/106_ProductionReadiness/data/production-readiness-2026-06-26.json`
- `WilliamOS/106_ProductionReadiness/reports/Production Readiness - 2026-06-26.md`

## Tag Rule

Create `v1.3.1` only after:

- release evidence is committed;
- `git status --short` is clean;
- `v1.3.1` does not already exist;
- `v1.3.0` still points to `2c44ff2a00bd28a312cd23b28a3011fa9261e20f`.

Do not push the tag. Do not merge. Do not open Phase 6.

## Next Lane

After `v1.3.1`, the next production-hardening lane is:

```text
WO-WILLIAMOS-PHASE5E-RUNTIME-ADAPTER-001
```

Purpose: make Ollama replaceable, not magical.
