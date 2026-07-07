# Hermes State Model

This state model is static doctrine. It is not a runtime state machine, database model, polling loop, permission engine, or worker activation path.

## States

| State | Meaning | Runtime active |
| --- | --- | --- |
| `DISABLED` | Hermes has no runtime, sidecar process, worker, queue, scheduler, command runner, or MCP bridge. | No |
| `PROPOSED` | A Work Order has proposed a future Worker Packet or activation review. | No |
| `BLOCKED` | Evidence, validation, scope, or authority is incomplete or unsafe. | No |
| `REVIEW_READY` | A packet has enough evidence for Owner review but no authority is granted yet. | No |
| `AUTHORIZED` | The Owner has explicitly approved a bounded future scope. | No runtime is implied |
| `ACTIVE_LIMITED_FUTURE` | A documented future state for a separately authorized runtime lane. | Not implemented here |
| `REVOKED` | Prior approval is withdrawn, expired, or blocked by safety failure. | No |
| `RETIRED` | A former packet or capability is kept as historical reference only. | No |

## Transition Rules

- `DISABLED` to `PROPOSED` only by Work Order.
- `PROPOSED` to `REVIEW_READY` only with packet, evidence, and blocked actions documented.
- `REVIEW_READY` to `AUTHORIZED` only by explicit Owner authority.
- `AUTHORIZED` to `ACTIVE_LIMITED_FUTURE` only in a future runtime-scoped goal.
- Any state to `BLOCKED` if validation, safety, evidence, or scope fails.
- Any state to `REVOKED` by Owner authority or expiration.
- `REVOKED` cannot continue work; it must return evidence and stop.

`ACTIVE_LIMITED_FUTURE` is only a named future state. This batch does not implement or activate it.

