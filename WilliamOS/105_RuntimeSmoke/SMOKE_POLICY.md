---
type: policy
status: active
area: runtime
created: 2026-06-16
tags:
  - runtime
  - smoke
  - policy
---

# Smoke Policy

## Rules

1. **No destructive actions.** The smoke suite only runs status and check commands. It never creates, modifies, or deletes notes.
2. **Critical commands block.** If a critical command fails (check, git-status, backup-status, schema-check), the overall result is FAIL.
3. **Non-critical commands warn.** If a non-critical command fails, the overall result is WARN but not FAIL.
4. **Reports go to `105_RuntimeSmoke/reports/`.** Generated smoke reports and JSON data are the only files written.
5. **30-second timeout per command.** Any command that hangs is marked TIMEOUT.
6. **No internet required.** All smoke commands are local.
7. **No plugins required.** All smoke commands work without Dataview or other plugins.
