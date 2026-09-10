# WO-UI-005 — Owner Acceptance, Visual Polish, and Product Feel

PROGRAM: `WILLIAMOS_EXPERIENCE_V2`
GOAL: Prove the new WilliamOS UI/UX is actually the product the owner asked for.
LOOP: `UI_PRODUCT`
STATUS: `READY`
RISK_CLASS: `UI_ONLY`
DEPENDS_ON: `WO-UI-001`, `WO-UI-002`, `WO-UI-003`, `WO-UI-004`

PURPOSE:
Prevent another false finish. The UI is not done because tests, screenshots, or PRs pass. It is done when the owner can open WilliamOS and use a coherent living AI operating environment without explanation.

CURRENT_TRUTH:
- Previous passes repeatedly declared completion around infrastructure or narrow browser journeys while the owner still saw the wrong product.
- This WO is deliberately owner-visible and product-first.
- Acceptance follows the capabilities the product truthfully exposes. It does not manufacture prerequisites merely to satisfy a fixture count.

ALLOWED_FILES_OR_AREAS:
- Experience V2 UI/product surface
- visual polish
- interaction polish
- focused accessibility/responsive tests
- reference HTML if acceptance changes require clarifying the visual target

BLOCKED:
- new architecture programs
- HERMES/orchestration work
- TerraFusion backend/product work
- declaring success from CI alone
- holding a finished visible UI hostage to an unrelated capability-count prerequisite

OWNER JOURNEY:
1. Open WilliamOS.
2. Enter/re-enter TerraFusion Space.
3. Recognize the Space and current work immediately.
4. Open/edit/save real source.
5. Move/resize/rearrange serious work surfaces.
6. Work with developer preview, tests/diffs/terminal.
7. Select a file and use `Ask / Change / Delegate / Review`.
8. Summon The Line with Ctrl+K and direct an agent without restating context.
9. See active agents and what they are doing.
10. Receive a meaningful proactive William judgment.
11. Inspect/override William's suggestion.
12. Summon Brain Council for a real strategic question.
13. Dismiss Council and return to the exact work position.
14. Open Mission Control, see every actual live Space plus any clearly disabled reference projections, and re-enter any enterable live Space without losing place.
15. Close/reopen WilliamOS and recover the useful environment.

If the current product exposes only one live Space, step 14 is satisfied by truthful one-Space Mission Control plus successful re-entry into that live Space. When a later product slice introduces multiple live Spaces, that slice must prove cross-Space re-entry between them.

VISUAL ACCEPTANCE:
The owner should be able to say all of the following without being coached:

- `This looks like WilliamOS.`
- `I can see my AI team.`
- `I know how to give them work.`
- `William feels present.`
- `This is not another dashboard.`
- `This is not just VS Code.`
- `The AI is part of the environment, not a bolted-on chat.`
- `I can actually work here.`

ANTI-SLOP CHECK:
Reject the build if any are true:
- giant generic hero cards
- excessive glass/glow/gradients with no semantic purpose
- permanent chatbot occupying major screen area
- every function represented as a status card
- fake agent activity
- fake live Spaces
- TerraFusion business UI used as WilliamOS chrome
- tiny toy windows
- fixed three-column website pretending to be an OS
- AI labels with no actionable behavior
- generic motivational William copy

ACCEPTANCE_CRITERIA:
- All owner journey steps work in the deployed/browser-accessible product surface, interpreted against actual live product capabilities rather than invented fixtures.
- Major UI states are browser-reviewed, not inferred from source.
- Desktop and reduced-width layouts are usable.
- Keyboard focus, contrast, and motion are reasonable.
- No unresolved blocking review finding.
- The product survives at least one full close/reopen cycle with useful continuity.
- Mission Control never misrepresents reference projections as live Spaces.
- Owner-visible defects found during acceptance are fixed in this lane before calling it done.

VALIDATION:
- production build
- deterministic focused tests
- real browser session
- owner use

REVIEW_REQUIREMENTS:
Final reviewer should behave like a product critic, not only a code reviewer. If the product is technically correct but visually generic, awkward, confusing, or AI-powerless, return CHANGES_REQUIRED.

EVIDENCE_PATHS:
- `prototypes/workspace.html`
- `prototypes/brain-council.html`
- `prototypes/mission-control.html`

NEXT_ON_PASS:
W1 Experience V2 UI/UX can be called complete.

NEXT_ON_BLOCK:
Fix the visible product defect. Do not start a new infrastructure lane unless the exact UI journey is impossible and no truthful fixture can preserve progress.