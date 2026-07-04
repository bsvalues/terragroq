# WO-WOE-026 — Blocked Decision Detail Surface

## Result

PASS.

The WOE detail model includes a blocked decision detail surface explaining why
runtime control and metadata expansion cannot proceed.

```text
BLOCKED_DECISION_DETAIL_ADDED: true
BLOCKER_VISIBLE: true
WHY_BLOCKED_VISIBLE: true
OWNER_DECISION_VISIBLE: true
SAFE_NEXT_ACTION_VISIBLE: true
PROHIBITED_ACTIONS_VISIBLE: true
APPROVAL_CONTROLS_ADDED: false
AUTH_POLICY_CHANGED: false
```

## Validation

```text
npm test -- --run tests/woe-detail-surface.test.ts ...: pass
```

## Next Recommended WO

```text
WO-WOE-027 — Safety Posture Badge System
```
