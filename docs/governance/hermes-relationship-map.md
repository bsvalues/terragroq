# Hermes Relationship Map

> **Supersession note.** "Hermes" in this document is the governed in-app *sidecar / worker-boundary
> concept* and its state model. The physical **HERMES coordinator node** and the resident
> **Hermes→AEGIS ExecutionBackend (PR #754)** are OPERATING, governed by
> [`sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md).
> Read "disabled by default / not active / future worker" below as the safety posture of this bounded
> lane — not as the status of the operating runtime.


Hermes is one governed concept inside the WilliamOS operating model. It cannot bypass the rest of the system.

| System | Relationship |
| --- | --- |
| Work Orders | Source of bounded tasks, validation, stop conditions, and evidence requirements. |
| Evidence | Proof of reality and completion. Hermes cannot substitute claims for evidence. |
| Authority | Gate for activation, capabilities, production writes, secrets, runtime, tools, and revocation. |
| Brain Council | May recommend Hermes-related work; cannot activate or execute. |
| Agent Forge | Prepares and reviews skills before Hermes may ever use them. |
| Memory | Stores governed knowledge; not uncontrolled instructions or runtime memory read authority. |
| Trace | Records future worker reasoning, failures, and evidence if runtime is ever authorized. |
| Academy | Teaches safe use and blocked-state interpretation. |
| Wiki | Records durable Hermes concept doctrine. |
| Projects | Systems under command, never targets without Work Order and authority. |
| Primary | Final authority for activation, revocation, and scope. |

This map is documentation only. It adds no integrations, runtime wiring, data flows, background indexers, or activation paths.

