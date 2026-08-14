# Hermes Activation Review Packet Schema

> **Supersession note.** "Hermes" in this document is the governed in-app *sidecar / worker-boundary
> concept* and its state model. The physical **HERMES coordinator node** and the resident
> **Hermes→AEGIS ExecutionBackend (PR #754)** are OPERATING, governed by
> [`sovereign-runtime-and-review-supersession.md`](sovereign-runtime-and-review-supersession.md).
> Read "disabled by default / not active / future worker" below as the safety posture of this bounded
> lane — not as the status of the operating runtime.


An Activation Review Packet is required before any future Hermes authorization request can be considered. It is a static review artifact in this lane, not an activation workflow.

## Required Fields

| Field | Purpose |
| --- | --- |
| `activation_packet_id` | Stable activation review identifier. |
| `related_goal` | Goal requesting future activation. |
| `related_work_order` | Work Order that bounds the request. |
| `requested_worker_packet` | Worker Packet under review. |
| `requested_capabilities` | Exact capabilities requested. |
| `requested_permissions` | Permissions requested and denied. |
| `allowed_surfaces` | Surfaces where Hermes may operate if later approved. |
| `blocked_surfaces` | Surfaces explicitly out of scope. |
| `risk_classification` | Safety class and risk explanation. |
| `evidence_reviewed` | Evidence used for review. |
| `tests_required` | Tests required before and after activation. |
| `secrets_exposure_assessment` | Whether secrets could be touched. |
| `production_write_assessment` | Whether production writes could happen. |
| `rollback_plan` | Disable and rollback procedure. |
| `monitoring_logging_plan` | Required evidence and trace capture. |
| `owner_decision_required` | Owner authority required before any activation. |
| `approval_status` | Current approval state. |
| `expiration_review_date` | Required expiration or review point. |

## Rules

- No activation without explicit Owner authority.
- No activation without evidence.
- No activation without a bounded Work Order.
- No indefinite authorization.
- No broad wildcard permissions.
- No hidden escalation.
- No auth policy change in this lane.
- No permission model implementation in this lane.

