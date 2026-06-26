# 60 — Rust Bridge Boundary

**Work Order:** WO-WILLIAMOS-NEXT-TAURI-ARCH-001
**Lane:** F — Rust bridge architecture (plan only)
**Status:** DRAFT
**Phase 6:** BLOCKED

---

## 0. Role

Rust is the **local reliability layer** behind Tauri: process supervision, port
checks, safe path handling, native bridges. Rust is a **mechanism**, never a
**policy/authority**. All consequential decisions stay in the WilliamOS control
plane `[REFERENCED]`.

---

## 1. Allowed Rust responsibilities

| Capability | Notes |
| --- | --- |
| Process supervision | Spawn/monitor/restart the WilliamOS backend + Next.js server as **child processes**; capture exit codes |
| Single-instance lock | Ensure one operator app; focus existing instance |
| Port checks | Detect/claim expected ports; report conflicts |
| Backend launcher | Invoke the **governed** launcher/CLI; pass through, don't reimplement |
| Filesystem path normalization | Canonicalize/validate paths before handing to the shell |
| Native file dialog / drop bridge | Deliver file references to the governed intake path |
| Open file/folder in OS | Read-only "reveal in Finder/Explorer" |
| Worker timeout / cancel bridge | Send cancel/timeout signals to worker processes on operator command |
| stdout/stderr capture | Stream child output to logs / shell (display only) |

---

## 2. Forbidden Rust responsibilities

| Forbidden | Why |
| --- | --- |
| Memory governance authority | Lives in Python/Next.js registers |
| Canon promotion | Operator-gated governance action |
| Decision authority | Decision Register only |
| Worker approval authority | Workers propose; Bill approves |
| Direct commits | Git authority is operator/CLI only |
| Release tagging | Release gate only |
| Silent model fallback | Explicit-runtime-only policy |
| Cloud calls | No cloud fallback |
| Arbitrary command execution | Must route through governed launcher/safety tiers |

---

## 3. Command surface (Tauri ⇄ Rust)

Expose a **small, explicit** set of Rust commands. Illustrative only — not built
in this pass:

```
backend_status() -> { running, pid, port, healthy }
backend_start()  -> delegates to governed launcher
backend_stop()   -> graceful child shutdown
backend_restart()-> stop + start (idempotent)
runtime_check()  -> { ollama: bool, model_present: bool }   // status only
port_check(port) -> { free: bool, owner_pid? }
normalize_path(p)-> { canonical, within_allowed_root: bool }
reveal_in_os(p)  -> opens file manager (read-only)
worker_cancel(id)-> sends cancel/timeout signal
```

Each command:
- validates inputs (path roots, allowed ports),
- performs a **mechanical** action only,
- returns structured status,
- never makes a governance decision.

---

## 4. Path safety

- All paths normalized + checked against an **allowed root set** before use.
- Reject traversal (`..`), symlink escapes, and out-of-root absolute paths.
- File drop / dialog results are references; ingestion authority stays in the
  governed intake path.

---

## 5. Process safety

- Children are owned by the supervisor; killed on app exit (no orphans).
- Restart honors single-instance + port checks.
- Backend launch always goes through the governed launcher so safety tiers apply.

---

## 6. Result

- **RESULT:** PASS
- **LANE:** F (plan only)
- **FILES_CHANGED:** this document only
- **PHASE_STATUS:** Phase 6 BLOCKED
- **NEXT:** `70_DATA_STORAGE_BOUNDARY.md`
