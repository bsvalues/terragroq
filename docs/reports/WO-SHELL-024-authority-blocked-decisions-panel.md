# WO-SHELL-024 — Authority / Blocked Decisions Panel

## Result

PASS.

The Primary Home now exposes a read-only Authority / Blocked Decisions panel.

## Blocked Decisions Visible

```text
local runtime control: blocked
Docker/backup/port metadata expansion: blocked
command execution / Hermes / MCP / autonomy: blocked
external mutation / cloud / DNS / TerraFusion / PACS: blocked
```

## Boundary

```text
AUTHORITY_PANEL_UPDATED: true
BLOCKED_DECISIONS_VISIBLE: true
LOCAL_STATUS_BOUNDARY_VISIBLE: true
APPROVAL_CONTROLS_ADDED: false
AUTH_POLICY_CHANGED: false
ACCESS_GRANTS_IMPLEMENTED: false
```

## Validation

```text
npm test -- --run tests/home-command-center.test.ts tests/shell-woe-resume-surface.test.ts: pass
```

## Next Recommended WO

```text
WO-WOE-019 — Active Work Queue Read Model
```
