# WO-WOE-034 — `/goal` Detail Model

## Result

PASS.

## Scope

Added a static `/goal` detail model to the WOE surface for goal id, purpose,
success state, active batch, blockers, and next recommended work.

## Safety

The model is read-only and does not mutate goals, grant authority, or continue
loops autonomously.
