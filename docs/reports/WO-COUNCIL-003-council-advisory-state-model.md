# WO-COUNCIL-003 — Council Advisory State Model

RESULT: PASS

Added static advisory states: NOT_REQUESTED, CONTEXT_NEEDED, EVIDENCE_REVIEW, OPTIONS_REVIEW, RISK_REVIEW, DECISION_PACKET_READY, OWNER_DECISION_NEEDED, WORK_ORDER_RECOMMENDED, BLOCKED_BY_AUTHORITY, and ADVISORY_COMPLETE.

States are display states only. They do not mutate, persist, execute, or run a state machine.

SAFETY: Static state model only. No state mutation, persistence, scheduler, runtime state machine, or background worker was added.
