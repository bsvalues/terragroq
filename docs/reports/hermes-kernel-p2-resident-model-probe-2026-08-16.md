# P2 — resident-model executor probe on HERMES (2026-08-16)

Owner-triggered live smoke of the S2 adapter (`createHermesKernelClient`, PR #804) over the
Hermes-Agent lane in **owned-worktree mode**. Everything below was executed from OMEN over
`ssh hermes` (Windows PowerShell), read back and verified; nothing on the canonical checkout or in
the repo policy was mutated by the kernel.

## Setup (recorded)

| Item | Value |
|---|---|
| Kernel host | HERMES (`hermes\bs`), Docker 28.5.1, image `williamos-hermes-agent:0.20.0-fa83af3` id `612bd343622e` (matches policy pin), `williamos-hermes-inference-proxy` healthy |
| Checkout | `C:\HermesLab\terragroq-s2` = `main@49c01a4` (bundle clone), later `fix/s2-harvest-rendered-fence@a6084ff` |
| Runtime root | `C:\Users\bs\.williamos\hermes-bridge` (matches `placement.allowedWorkspaceRoots` literal) |
| Probe worktree | `<runtime root>\worktrees\p2-resident-probe`, `git worktree add -b p2/resident-probe … main` |
| Policy | **probe copy** `D:\HermesServices\williamos-hermes-agent\hermes-free-dev-agent-v2.probe.policy.json` = repo v2 with `OWNED_WORKTREE_CONFINEMENT_PROVEN: "P2-PROBE-2026-08-16-PROVISIONAL"` (repo policy stayed `null` for the runs; written BOM-less — PowerShell 5 `-Encoding UTF8` adds a BOM which the client rejects as `RESIDENT_MODEL_LANE_POLICY_UNREADABLE`, correctly) |
| Invoker | repo `scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1` (v2), deployed `compose.yaml`/`run_agent.py` (byte-identical to repo modulo CR) |
| Driver | `scripts/hermes-bridge/resident-model-probe.mjs` (added by this change; the ad-hoc driver used for the runs was identical in behaviour) |
| Task | add one comment line as the first line of `lib/workbench/thread-trust.ts` (a reservation of the registered contract); report the schema JSON |

## Runs

| Run | Head | Result | Turn | Notes |
|---|---|---|---|---|
| 1 | 49c01a4 | `RESIDENT_MODEL_LANE_POLICY_UNREADABLE` at connect | — | BOM in probe policy (PowerShell). Fail-closed as designed. |
| 2 | 49c01a4 | thread `444db7cd-60cd-4e7f-aae7-ca9072a0ec86`, turn `aacd3931-a75d-46fe-9b7e-dd76e5ab9700`, invoker exit 0, `APP_SERVER_TURN_FAILED` detail `RESIDENT_MODEL_TURN_OUTPUT_INVALID:NO_JSON_BLOCK` | 5m20s | Kernel made exactly the requested edit and printed a schema-complete answer, but the Hermes CLI renders markdown fences as boxes; the fenced-block harvester missed it. Captured stdout kept as `tests/fixtures/hermes-kernel/p2-run-aacd3931-stdout.txt`. |
| 3 | a6084ff | thread `148486b4-3a5a-4965-a3bf-9c8cb33aa7ef`, turn `b9fbca28-6fea-4898-9533-b556008ff300`, invoker exit 0, **`status: completed`**, `harvested: true`, schema-valid `finalText` | 4m34s | Harvester now takes the last balanced top-level object; validator still gates. |

Evidence hashes (run 3, `session.json`): `packetSha256 7b3aa984…1e511`, `stdoutSha256 d3f0f60d…c56b`.

## Confinement checks (after runs 2 and 3, identical)

- `git -C <worktree> status --porcelain --untracked-files=all` → exactly ` M lib/workbench/thread-trust.ts`; diff stat `1 file changed, 1 insertion(+)`; first line = `// P2 resident-model probe 2026-08-16`.
- Canonical checkout `C:\HermesLab\terragroq-s2`: `git status --porcelain` → 0 lines.
- `docker ps -a` agent containers after run: 0 (exact-container cleanup held).
- Quarantine markers: runtime-root marker absent; policy-dir marker absent.
- `node_modules` in worktree: absent. `git-common-dir` pre/post check passed (client walls on mismatch; it did not).
- COMPLETE line runId matched the sent runId both times.

**Verdict:** owned-worktree confinement proven for the reviewed lane on this host —
`OWNED_WORKTREE_CONFINEMENT_PROVEN` set to `p2-b9fbca28-6fea-4898-9533-b556008ff300` in the repo
v2 policy by this change.

## Resume probe

`resumeThread` → `RESIDENT_MODEL_THREAD_RESUME_UNAVAILABLE` (fail-closed, `sessionResumeProven:false`).
The kernel itself printed `hermes --resume 20260816_200044_30d6e1` — sessions exist inside the
container but live on tmpfs (`/opt/data`) and die with it. Kernel continuity therefore needs the
per-thread state mount (spec §4 item 3, deferred) — its own reviewed line (P2b). Not flipped.

## Findings / follow-ups

1. Harvester: rendered fences (fixed, `a6084ff`, with the real capture as a fixture).
2. `pnpm hermes:smoke` is the AEGIS/Codex transport smoke and cannot drive this lane — runbook
   corrected to `scripts/hermes-bridge/resident-model-probe.mjs`.
3. Policy files written from PowerShell 5 must be BOM-less (`[IO.File]::WriteAllText(..., UTF8Encoding($false))`).
4. HERMES runs a flat file deployment of `main@bc373452` under `C:\HermesLab\...`; the S2 code is not
   in the running deployment yet — wiring the resident orchestrator to `WILLIAMOS_EXECUTOR=resident-model`
   is a separate deployment decision.
5. Left on HERMES: probe worktree/branch `p2/resident-probe` (dirty by design), probe policy copy,
   thread evidence dirs under `<runtime root>\hermes-kernel\threads\`.
