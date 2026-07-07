# Hermes Worker Packet Schema

This schema describes a future review artifact. It is not executable. It does not load workers, call tools, run commands, write files, persist state, or activate Hermes.

## Required Fields

| Field | Purpose |
| --- | --- |
| `worker_packet_id` | Stable packet identifier. |
| `requested_by` | Person or Work Order requesting review. |
| `source_work_order` | Work Order that defines the bounded scope. |
| `goal` | Related goal. |
| `task` | Narrow task requested of the future worker. |
| `allowed_actions` | Exact actions that could be allowed if approved. |
| `blocked_actions` | Actions explicitly denied. |
| `required_inputs` | Inputs needed before work can begin. |
| `expected_outputs` | Evidence or artifacts the worker must return. |
| `authority_required` | Owner and registry gates required. |
| `evidence_required` | Evidence required before review and completion. |
| `timeout_or_boundaries` | Time, scope, surface, and stop limits. |
| `rollback_or_revocation_plan` | How the packet is disabled or revoked. |
| `logging_trace_requirement` | What must be recorded in Trace. |
| `safety_class` | Risk classification from the safety matrix. |
| `production_write_allowed` | Whether production writes are allowed. |
| `network_allowed` | Whether network access is allowed. |
| `filesystem_allowed` | Whether filesystem access is allowed. |
| `command_execution_allowed` | Whether command execution is allowed. |
| `status` | Packet state. |

## Default Values

- `production_write_allowed`: `false`
- `command_execution_allowed`: `false`
- `network_allowed`: `false` unless explicitly granted
- `filesystem_allowed`: `false` unless explicitly granted
- `status`: `proposed`

## Safety Rules

- A packet is not permission.
- A packet does not execute.
- A packet does not authorize Hermes activation.
- A packet cannot grant wildcard permissions.
- A packet cannot override blocked actions.
- A packet must stop if authority, evidence, or safety is incomplete.

