# Reference — Audit, Evidence & the Event Log

WilliamOS is built so that you can always reconstruct *what happened, who allowed
it, and why*. Three mechanisms provide this: the general event log, the append-only
governance event log, and the evidence ledger.

- **Tables:** `event_log`, `governance_event`, `evidence_record`
- **Primitives:** `lib/governance/events.ts`, `lib/governance/hash.ts`, `lib/governance/artifacts.ts`
- **Surfaces:** `/audit`, `/governance`

---

## 1. Event log (general activity)

`event_log` is the human-facing activity feed. Every meaningful state change in any
register appends a row:

| Field | Meaning |
| ----- | ------- |
| `type` | Event type (e.g. `goal.classified`, `work_order.transition`). |
| `summary` | Human-readable description. |
| `register` | Which register it concerns. |
| `refId` | The affected row id. |
| `metadata` | Arbitrary JSON context. |

This powers the `/audit` timeline.

---

## 2. Governance events (append-only, hash-chained)

`governance_event` is the tamper-evident log for governance-critical changes —
authority grants/revocations, lock releases, conflict resolutions, etc. It is
**never updated in place**. Every change appends a new event with before/after
content hashes so the history of how a state came to exist can be reconstructed and
verified.

| Field | Meaning |
| ----- | ------- |
| `eventType` | e.g. `AUTHORITY_GRANTED`, `AUTHORITY_REVOKED`, `LOCK_RELEASED`. |
| `entityType` / `entityId` | What the event concerns. |
| `actor` | Who performed it. |
| `reason` | Why. |
| `beforeHash` / `afterHash` | Content hashes (`lib/governance/hash.ts`) for tamper evidence. |
| `evidenceId` | Optional link to an evidence record. |
| `metadata` | JSON context. |

Because it is append-only and hashed, you can detect after-the-fact tampering: if a
record's content no longer matches its recorded hash, the chain is broken.

---

## 3. Evidence ledger (§11)

`evidence_record` is operator-grade proof attached to a work order:

| Field | Meaning |
| ----- | ------- |
| `result` | `PASS \| FAIL \| PARTIAL`. |
| `repo`, `branch`, `head`, `worktreeStatus` | The exact state proven against. |
| `filesChanged`, `validators` | What changed and how it was checked. |
| `knownFailures`, `outOfScopeChanges`, `deferredItems` | Honest caveats. |
| `nextValidMove`, `notes` | Follow-up. |
| `contentHash` | Tier-2/3 tamper-evidence hash. |
| `artifactPath` | Filesystem path of the persisted artifact (`lib/governance/artifacts.ts`). |

Actions in `app/actions/evidence.ts`:

| Action | Effect |
| ------ | ------ |
| `recordEvidence(input)` | Persist an evidence record (with hash + artifact). |
| `getEvidenceForWorkOrder(woId)` | Evidence for a WO. |
| `getRecentEvidence(limit)` | Recent evidence across WOs. |

Artifacts are written under `docs/devkit/` (e.g. authority grants and the evidence
ledger), giving a filesystem copy alongside the database record.

---

## 4. Supporting governance registers

These feed the audit story and are surfaced under `/governance`:

| Register | Action file | Purpose |
| -------- | ----------- | ------- |
| `truth_claim` | `app/actions/truth.ts` | Current Truth with freshness; volatile claims must be rechecked before mutate/commit/push/tag/release (`getRecheckBlockers`). |
| `agent_claim` | `app/actions/agent-claims.ts` | Agent assertions, untrusted until evidence-backed. |
| `conflict_record` | `app/actions/conflicts.ts` | Unresolved high-risk conflicts block loops. |
| `lock_record` | `app/actions/locks.ts` | HOLD/STOP/FREEZE locks with a deliberate release protocol. |
| `parked_idea` | `app/actions/vault.ts` | The Not-Now Vault; parked ideas can't create loops. |

---

## The audit guarantee

Putting it together: a mutating action requires an authority grant (logged), runs
through a loop that records its iteration, produces an evidence record (hashed +
persisted to disk), and emits an append-only governance event with before/after
hashes. That chain is what lets WilliamOS answer "who allowed this, when, why, and
can we prove it wasn't altered?" — by construction, not by trust.
