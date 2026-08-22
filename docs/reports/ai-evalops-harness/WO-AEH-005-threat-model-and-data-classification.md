# WO-AEH-005 - Threat Model and Data Classification

Result: `COMPLETE / MODEL_VERIFIED / INDEPENDENT_REVIEW_PASS`

Created `docs/governance/ai-evalops-harness/threat-model-and-data-classification.md`
as the repository-scoped AEH threat model bound to terragroq
`13709f5789c25dea408283730a6bd35e8fd894ab` and the read-only HermesLab evidence
boundary `0481061acf1f683688a00b09795647d0288c7232`.

The model covers assets, actors, nine trust boundaries, six data classes,
attacker/operator/developer-controlled inputs, assumptions, mandatory invariants,
web/retrieval, durable-control, worker/provider, supply-chain, telemetry,
evidence, backup, and node-operation attack surfaces, existing mitigations,
out-of-scope capability claims, and contextual severity calibration.

Validation: required section and footer scan passed; identifier/reference scan
passed; no secret values or protected payloads were added; `git diff --check`
passed. No runtime, host, network, database, backup, or worker mutation occurred.

Maturity before: `MODEL_PLANNED`. Maturity after: `MODEL_VERIFIED candidate`,
confirmed by independent review. Reviewer `/root/packet_assurance` verified the
exact cache footer, grounded existing/planned/required controls, input ownership,
retention, non-overclaim posture, references, secret scan, and diff hygiene and
returned `PASS` with no blockers. This document is a design/security contract and does
not prove enforcement, adapter safety, recovery, soak, or production authority.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
