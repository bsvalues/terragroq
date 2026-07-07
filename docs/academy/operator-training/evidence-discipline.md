# Evidence Discipline

Evidence is how WilliamOS proves reality.

## Evidence Sources

- `git diff --check`.
- Focused tests.
- Full test suite.
- Production build.
- PR checks.
- Production `/api/health`.
- Production `/api/auth/readiness`.
- Route proof when scoped.
- Safety regression tests.
- Work Order reports.

## Evidence Rules

- Evidence records what happened.
- Evidence does not grant authority.
- Evidence must be current enough for the decision being made.
- Stale evidence must be treated as review context, not controlling truth.
- Failed evidence must be classified before action continues.

## Safety Posture

Every batch should state what did not change. Common protected boundaries include command execution, DB/schema, secrets, cloud settings, runtime control, persistence, LAN exposure, metadata expansion, and autonomy.
