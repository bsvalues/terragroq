# WO-HERMES-6-001 Home Operational Command Center

## Owner outcome

Make WilliamOS Home a complete operational command center where the owner can see what is active, what is blocked, what needs an owner decision, what recently finished, and open the supporting evidence.

## Product behavior

Home now presents one bounded four-lane operational radar:

- **Now / Active work** shows up to three `approved`, `active`, or `review` Work Orders.
- **Held / Blockers** shows up to three `blocked` Work Orders and the first recorded stop condition or blocker description.
- **Decide / Needs your decision** shows up to three proposed decision records, with the recorded rationale or decision text.
- **Landed / Recent outcomes** shows up to three `closed` or `aborted` Work Orders and their recorded result.

Each lane keeps its complete count separate from its three displayed rows. Work and decision rows remain narrow, user-scoped database projections ordered by the signal that matters for that lane. No full register is materialized on Home.

## Evidence navigation

Every radar item states whether supporting evidence is linked. Items with evidence expose a separate **Open supporting evidence** link to the read-only Evidence surface and show the number of linked references. Items without evidence say **Evidence not linked** and do not manufacture a link or imply proof that is absent.

The work or decision action and the evidence action are separate keyboard-focusable links. This avoids nested interactive controls and keeps the owner-facing choice explicit: inspect the governed record or inspect its proof.

## Visual direction

The established WilliamOS radar language remains the signature element and expands from three to four truthful signals. Primary, warning, violet authority, and success rails distinguish active work, blockers, owner decisions, and completed outcomes. The layout is one column on narrow screens, a two-by-two board at medium widths, and a four-lane command rail on wide screens.

## Files

- `app/(shell)/home-work-radar-query.ts`
- `components/dashboard/home-command-center.ts`
- `components/dashboard/home-work-radar-panel.tsx`
- `tests/home-command-center.test.ts`
- `docs/reports/WO-HERMES-6-001-home-operational-command-center.md`

## Safety boundary

- Read-only Home and navigation behavior only.
- No Work Order execution, decision mutation, approval, authority grant, runtime control, deployment, production write, credential access, or external API was added.
- Property Workbench, TerraPilot, TerraFusion, county/PACS systems and data, the rejected issue `#357` adapter, and all runtime-operator execution paths remain untouched.
- No `.obsidian/` content is modified.

## Independent review

The first read-only assurance lane exhausted three repository-read attempts at the Windows sandbox process-spawn boundary and was recorded `PROVIDER_UNAVAILABLE`; no finding was invented from that unavailable lane. A separate independent reviewer then assessed the exact query, model, panel, focused-test, and report snapshots. It found no Critical or Important issues and returned `READY` for Hermes-host validation.

Two minor findings were remediated before handoff: every focused lane fixture now supplies a fourth item and proves the defensive three-item display limit, and the unused decision `updatedAt` projection/type field was removed while database ordering by `updatedAt` remains intact. The independent reviewer re-reviewed that bounded patch and again returned `READY` with native execution explicitly pending.

## Validation handoff

The App Server task did not run native validators, Git, or GitHub commands. Hermes owns focused Vitest validation, lint, the full test run, and the production build after file handoff. Until that host evidence exists, this report records implementation and file review only; it does not claim passing execution validation.
