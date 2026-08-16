# P2b — kernel session continuity on HERMES (2026-08-16)

Follow-up to [P2](hermes-kernel-p2-resident-model-probe-2026-08-16.md). P2 proved owned-worktree
confinement but left `resumeThread` fail-closed: the kernel's `HERMES_HOME` (`/opt/data`) was a
container tmpfs, so the session it printed (`hermes --resume <id>`) died with the container. P2b
gives each WilliamOS thread a durable kernel state directory and proves a second turn continues the
first turn's session.

## Change under test

| Layer | Change |
|---|---|
| compose | new `agent-owned` service: identical to `agent` but `/opt/data` is a bind mount of the thread's state dir instead of tmpfs (`agent` untouched, still tmpfs) |
| runner | `run_agent.py` honours `WILLIAMOS_RESUME_SESSION` (re-validated `^[A-Za-z0-9_-]{4,64}$`) → `hermes chat --resume <id>` |
| invoker | `-StatePath` (absolute; must sit under `<runtime root>\hermes-kernel\threads`; no reparse-point components), packet v3 field set (`statePath`, `kernelSessionId`), walls `STATE_MODE`/`STATE_PATH`/`SESSION_ID`, runs `agent-owned`, passes the resume id |
| client | `startThread` creates `<thread>/kernel-state`; `runTurn` passes `-StatePath` and the previously captured session id, and captures the kernel's `Session: <id>` line into `session.json`; `resumeThread` additionally requires a captured session id **and** the state dir |
| policy v2 | `containment.agentStatePersistence: "PER_THREAD_STATE_DIR"`, `packetSchemaVersion: 3` |

## Run (HERMES, checkout `feat/s2-p2b-kernel-session-state@1bbda4c`)

Thread `a1f10950-62b4-46ff-b17a-509edf738772`, probe worktree `<runtime root>\worktrees\p2-resident-probe`,
probe policy = repo v2 (BOM-less copy).

| Turn | Turn id | Prompt | Result | Kernel session |
|---|---|---|---|---|
| 1 | `f6e03ebf-4e11-47b5-b2b6-96f2c1c72120` | edit one reserved path + report | `completed`, harvested, 5m21s | started `20260816_210244_3232c2` (`resumedKernelSessionId: null`) |
| 2 | `1f789bdf-4f51-45f4-aeb3-5080f60a5344` | **tool-free**: recall from session memory which comment you added and to which file | `completed`, harvested, **1m32s** | `resumedKernelSessionId: 20260816_210244_3232c2` |

Turn 2's answer (`validation` array): `["// P2 resident-model probe 2026-08-16", "/workspace/lib/workbench/thread-trust.ts"]` — the
exact marker and the exact file, recalled with no tool calls. The driver asserts both
(`continuity.recalledMarker`, `continuity.recalledFile` → true). The 3.5× faster turn is consistent
with no tool round-trips.

**Continuity proven.** `execution.sessionResumeProven` flipped to `true`; new evidence line
`KERNEL_SESSION_CONTINUITY_PROVEN = p2b-1f789bdf-4f51-45f4-aeb3-5080f60a5344` (the evidence gate is
enforced, so a declared-but-unproven line still closes the lane).

## Containment re-checked after the two-turn run (identical to P2)

- worktree: exactly ` M lib/workbench/thread-trust.ts`, `1 file changed, 1 insertion(+)`
- canonical checkout `C:\HermesLab\terragroq-s2`: 0 dirty lines
- `docker ps -a` agent containers: 0 · quarantine markers (runtime + policy dir): absent
- `node_modules` in worktree: absent · git-common-dir pre/post check passed both turns
- thread state dir: 5.4 MB, kernel layout (`state.db`, `sessions/`, `memories/`, `logs/`, …), 2 turn dirs recorded

## Notes

- Sessions live in `state.db` (SQLite) inside `HERMES_HOME`, not as loose files under `sessions/`;
  binding the whole `HERMES_HOME` is therefore the correct unit, not a `sessions/` subdir.
- `resumeThread` remains a per-thread gate even with the policy flag on: it fails closed unless that
  thread captured a session id and its state dir still exists.
- Left on HERMES: probe worktree/branch, probe policy copy, thread dirs (incl. `kernel-state`),
  `compose.yaml.bak-*` / `run_agent.py.bak-*` backups of the pre-P2b lane files.
- The deployed lane files under `D:\HermesServices\williamos-hermes-agent\` were updated from the
  repo (LF, BOM-less); the pinned image is unchanged — P2b needed no image rebuild.
