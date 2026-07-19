# WO-MAO-061 - Unattended Multi-Agent Certification Rejection

Program: `PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001`

Result: `COMPLETE_EVIDENCE_BACKED_REJECTION`

## Verdict

Unattended multi-agent builder certification is rejected.

WilliamOS has proven hosted Codex session delivery, useful work, review
remediation, merge fan-in, and live recovery behaviors. It has not proven a
durable unattended background operator that keeps executing after the hosted
session ends.

## Accepted Proof

- `HOSTED_CODEX_OPERATOR_ENGINEER`: `LIVE_AND_ADVANCED`
- `LIVE_RECOVERY`: `PROVEN`
- `FAN_IN_RELEASE`: `PROVEN`
- `TEN_USEFUL_WORK_ORDER_GATE`: `SATISFIED`
- `OWNER_TOUCH_COUNTERS`: `ZERO`

## Rejected Proof

```text
UNATTENDED_MULTI_AGENT_BUILDER: NOT_PROVEN
DURABLE_BACKGROUND_RUNTIME: NOT_ACTIVE
BETWEEN_SESSION_EXECUTION: NOT_OBSERVED
SOAK_CERTIFICATION_ACCEPTED: false
```

## Reason

The required 24-hour soak was not continuously operated by a durable runtime or
background dispatcher. The elapsed deadline passing after the session stopped is
not evidence of unattended operation.

## Result

`WO-MAO-061` is complete as a rejected certification. Future claims must keep
hosted-session capability separate from durable unattended runtime capability.
