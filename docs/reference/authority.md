# Reference — Authority

Authority is the spine of WilliamOS. The central rule is simple and absolute:

> **Approval is not authority.** Approving a work order describes intent. Acting
> above read-only requires a separate, explicit, durable *grant*.

- **Levels:** `lib/goal/taxonomy.ts` (`AUTHORITY_LEVELS`, A0–A9)
- **Grant registry:** `app/actions/authority.ts`, table `authority_grant` (WO-011)
- **Enforcement:** `lib/goal/loop-engine.ts` (`evaluateLoop`)

---

## The A0–A9 ladder

| Level | Rank | Permitted |
| ----- | ---- | --------- |
| `A0_READ_ONLY` | 0 | Read and report. No writes. |
| `A1_DRAFT` | 1 | Drafts/proposals. Nothing authoritative persisted. |
| `A2_WRITE_OWN` | 2 | Write own records inside an approved WO. |
| `A3_WRITE_SHARED` | 3 | Modify shared registers. Requires approval. |
| `A4_SCHEMA` | 4 | Additive schema changes. Requires approval. |
| `A5_DESTRUCTIVE` | 5 | Deletes / non-additive migrations. Approval each time. |
| `A6_AUTH` | 6 | Auth, sessions, secrets. Approval each time. |
| `A7_COMMIT` | 7 | Local commits. Requires approval. |
| `A8_PUSH` | 8 | Push to remote, open PRs. Requires approval. |
| `A9_RELEASE` | 9 | Tag, deploy, production release. Highest. |

`authorityRank(id)` returns the numeric rank; comparisons everywhere use rank so a
grant only covers actions at or below its level.

`LANE_MAX_AUTHORITY` caps each lane: `read_model` can never exceed A0; `docs`/`ui`
cap at A2; `write_model`/`integration` at A3; `schema` at A4; `auth` at A6;
`release` at A9.

---

## The Authority Grant Registry (WO-011)

A grant (`authority_grant`) is the durable proof of permission. Before any mutating
loop or A2+ transition, an active grant must exist that covers the requested level.

Grant fields of note:

| Field | Meaning |
| ----- | ------- |
| `authorityLevel` | The level granted (A0–A9). |
| `grantedBy` / `grantedTo` | Who granted, and to whom (operator / codex / claude / …). |
| `scope`, `allowedActions`, `blockedActions` | What the grant covers. |
| `status` | `active \| expired \| revoked`. |
| `expiresAt`, `revokedAt`, `revokeReason` | Lifecycle bounds. |
| `contentHash` | Tamper-evidence hash of the grant content. |
| `workOrderId` | The WO this grant authorizes. |

Actions in `app/actions/authority.ts`:

| Action | Effect |
| ------ | ------ |
| `createAuthorityGrant(input)` | Issue a grant; emits a governance event. |
| `getActiveGrantForWorkOrder(woId)` | Resolve the live grant the loop engine checks. |
| `getAuthorityGrants(limit)` | List grants. |
| `revokeAuthorityGrant(id, reason)` | Revoke; emits a governance event. |

---

## How enforcement works

In `evaluateLoop()`, for any **mutating** loop (`execute`):

```
if (!grant || !grant.active)            → STOP: "no active authority grant exists"
else if (loopRank > grant rank)         → STOP: "needs Ax but grant only provides Ay"
else if (repoDirty)                     → STOP: "resolve dirty state first"
```

The work order's `authorityGranted` field is a **display mirror only**. It is
deliberately *not* sufficient to permit a loop — the engine reads the grant record.
This closes the gap where a flag could be flipped without a real, auditable grant.

---

## Why this matters

This separation is the product's reason to exist. It means:

- An AI agent can propose, plan, and draft freely (A0–A1) with zero risk.
- Nothing it does can mutate shared state, schema, auth, or the repo without a
  human issuing an explicit grant that is logged, hashed, scoped, and revocable.
- Every elevation leaves an append-only trail (`governance_event`), so you can
  always answer "who allowed this, when, and why?"
