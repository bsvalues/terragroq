# Hermes Denied / Blocked UX Doctrine

> **Supersession note.** "Hermes" in this document is the governed in-app *sidecar / worker-boundary
> concept* and its state model. The physical **HERMES coordinator node** and the resident
> **Hermes→AEGIS ExecutionBackend (PR #754)** are OPERATING, governed by
> [`sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md).
> Read "disabled by default / not active / future worker" below as the safety posture of this bounded
> lane — not as the status of the operating runtime.


WilliamOS should show Hermes state calmly and precisely. Blocked is not failure; it is authority protection.

## UX States

| State | Copy guidance |
| --- | --- |
| Disabled by design | "Hermes is disabled by design." |
| Proposed but not authorized | "A worker packet has been prepared, but authority has not been granted." |
| Blocked by safety | "Activation blocked: evidence is incomplete." |
| Awaiting Owner authority | "Authorization required before Hermes can act." |
| Authorized for bounded future task | "Hermes is authorized only for the named bounded task." |
| Revoked | "Hermes authorization revoked." |

## Tone

- Calm
- Precise
- Non-alarming
- Owner-centered
- No sci-fi cosplay
- No fake personality
- No "AI agent unleashed" language
- No SaaS/team/admin/productivity drift

## Boundary

Denied or blocked UX must not include activation buttons, run buttons, command controls, polling, status probes, or runtime Hermes status. It may explain what is blocked, why it is blocked, what evidence is missing, and what future Owner decision would be required.

