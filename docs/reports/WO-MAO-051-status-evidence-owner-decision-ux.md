# WO-MAO-051 - Status, Evidence, and Owner-decision UX

Result: `PASS`

## Scope

WO-MAO-051 makes the selected multi-agent operator state easier to inspect in
the existing Portfolio Operator panel on `/goal-console`.

The change is a read-only UX and evidence-surface update. It does not add a
runtime scheduler, command runner, provider execution, GitHub operation,
production write, authority grant, owner operation control, or background
worker.

## Evidence

- Surface model: `components/operator/portfolio-operator-surface.ts`
- Renderer: `components/operator/portfolio-operator-panel.tsx`
- Tests: `tests/portfolio-operator-surface.test.ts`
- Report: `docs/reports/WO-MAO-051-status-evidence-owner-decision-ux.md`

Typed evidence hash:
`6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77`

## Acceptance

- Shows selected program and active Work Order.
- Shows Work Order status counts.
- Shows the active Work Order dependency satisfaction state.
- Shows the recent evidence trail from completed MAO Work Orders.
- Shows provider posture for hosted Codex, Claude Code, and rejected local nested Codex.
- Shows exact owner-authority walls from the portfolio backlog.
- Keeps `controls` empty.
- Preserves owner-only posture and zero owner-operation controls.

## Safety

- Runtime scheduler added: `false`.
- Command runner added: `false`.
- Provider execution added: `false`.
- GitHub operation added by model: `false`.
- Production write added: `false`.
- Background worker added: `false`.
- Authority grant added: `false`.
- Owner operation control added: `false`.
- Secrets exposed: `false`.
