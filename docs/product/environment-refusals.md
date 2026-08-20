# The replacement root's refusal list

Enumerated before code, per the owner's greenfield order (2026-08-20). The legacy Workbench is a
compatibility application only: **not a Surface, not the Desk, not the Environment**, and never the
root, container, import, wrapper, or visual model of the replacement. The replacement is built beside
it at `/environment` and refuses the following outright.

## Modules the new root will never import, render, wrap, or embed

| Refused | Why |
|---|---|
| `app/(shell)/**` | the legacy shell layout and every page inside it |
| `components/workbench/**` | the rejected product model: shell, activity, context, execution, controls, thread conversation |
| `components/intent/**` | the classify-then-navigate composer and its hooks |
| `components/chat/**` | the orphaned operator chat — a second composer by construction |
| `components/loom/workspace.tsx`, `components/loom/agent-thread.tsx` | the Loom shell composition (Loom's bounded APIs remain services) |
| `components/environment/environment.tsx`, `app/env/**` | the rejected first attempt — new panes composed around the legacy substrate |
| `lib/workbench/thread-projection`, `lib/workbench/load-threads` (as UI) | Thread-as-product; they remain backend loaders other services may use |

## Product vocabulary that must not appear in normal-work DOM

`HOME` · `PROJECTS` · `ACTIVITY` · `SYSTEM` · `Explorer` · `Inspect` · `Execution` ·
`Choose a Project` · `CURRENT THREAD` · `WORK RECORD` · project selection · thread lists ·
status-board composition · any second conversational input.

Enforced by `tests/environment-root.test.tsx`, not by memory: the test renders the root and fails on
any of these strings, fails on more or fewer than exactly one conversational input, and scans the new
root's source files for refused import paths.

## What survives as services (the backend IS the product's engine)

`lib/session`, `lib/db`, `lib/ai/*`, `lib/environment/*` (assumption policy, working world),
`app/api/loom/files|diff|run` (bounded, catalogued), `app/api/environment/*`, authority/Hermes/agents/
evidence/repositories/recovery underneath everything.

## Two hard invariants carried from live failures

1. **Anonymity is a server guarantee.** A browser surface reproducing an anonymous flow is served by
   the environment's own cookieless proxy — never by an optional client feature (`credentialless`
   worked in one browser and silently failed in the owner's, letting the legacy shell invade).
2. **One Line.** Exactly one conversational input exists in the environment, always.
