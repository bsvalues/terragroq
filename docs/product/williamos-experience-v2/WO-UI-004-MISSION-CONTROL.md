# WO-UI-004 — Mission Control and Durable Spaces

PROGRAM: `WILLIAMOS_EXPERIENCE_V2`
GOAL: Deliver Mission Control as truthful spatial re-entry into live Spaces.
LOOP: `UI_PRODUCT`
STATUS: `READY`
RISK_CLASS: `UI_ONLY`
DEPENDS_ON: `WO-UI-001-SPATIAL-WORKSPACE`, `WO-UI-002-WILLIAM-AND-AGENTS`

PURPOSE:
Let the owner zoom out, see what is alive, and re-enter real work without turning WilliamOS into a dashboard home page.

CURRENT_TRUTH:
- Spaces are durable working contexts.
- Mission Control should show actual live Spaces/windows and agent activity.
- The current product may expose one or many live Spaces; Mission Control must never invent extra live Spaces to satisfy a count.
- There is no Space named WilliamOS and no Home/System dashboard as the main product metaphor.

ALLOWED_FILES_OR_AREAS:
- Experience V2 Mission Control UI
- Space projection/layout components
- UI-only state/adapters over existing Spaces
- focused tests and fixtures

BLOCKED:
- creating a parallel Space database
- fake business dashboards as Space thumbnails
- replacing real windows with generic cards
- manufacturing fake live Spaces to satisfy acceptance
- infrastructure programs unrelated to rendering/re-entry

DELIVERABLES:
1. Mission Control summon/exit.
2. Live thumbnail/projection of every actual Space currently exposed by the product, with its current work surfaces.
3. Truthfully labeled reference/degraded projections when examples are useful but are not live.
4. Space names and current focus.
5. Active agent/session count and meaningful current activity.
6. Ability to enter any enterable live Space and restore its exact working context.
7. William ambient overview: what changed, what matters, what needs owner attention.
8. No dashboard-style KPI wall.

REFERENCE SPACES FOR FIXTURE:
- TerraFusion Build Space
- Research & Evidence Space
- Agent Operations / delegated work Space
- Review/Recovery Space

These are examples only. A reference projection must be visibly non-live and non-enterable unless backed by actual Space state.

MISSION CONTROL BEHAVIOR:
- Summon as an OS-level spatial view.
- Existing live Spaces remain live.
- Re-entry should restore window positions, selected objects, and useful context for every enterable live Space.
- If only one live Space exists, Mission Control truthfully presents that one live Space rather than inventing two more.
- William may surface concise ambient guidance, e.g. `Claude found one blocking issue in TerraFusion; nothing else needs you.`
- Mission Control is not a task dashboard and not a system admin console.

ACCEPTANCE_CRITERIA:
- User opens Mission Control and sees every actual live Space currently exposed by the product, represented by its actual work surfaces.
- Any reference/degraded Space projections are clearly labeled and disabled from false re-entry.
- Space previews look like working environments, not cards with metrics.
- Active agents are visible as ambient state without dominating the view.
- Activating any enterable live Space returns to the same source/preview/window arrangement and selected context.
- A live Space with no current runtime remains visible and truthful.
- William highlights meaningful changes without generating generic notification spam.
- No fake `Home`, `System`, or `WilliamOS` Space is introduced.
- The number of live Spaces is product truth, not an acceptance target.

VALIDATION:
- focused Mission Control truth/re-entry tests
- browser review against the live Spaces currently available
- persistence/reopen proof for enterable live Spaces
- when the product later supports two or more live Spaces, cross-Space re-entry becomes mandatory acceptance for that multi-Space capability rather than a retroactive blocker on this shell delivery

REVIEW_REQUIREMENTS:
Reviewer must attack:
1. Is this just a dashboard in disguise?
2. Are live previews actual Space state?
3. Are references unmistakably non-live?
4. Does re-entry preserve place for every enterable live Space?
5. Is agent state informative rather than noisy?
6. Does Mission Control respect the OS/environment metaphor?

EVIDENCE_PATH:
`docs/product/williamos-experience-v2/prototypes/mission-control.html`

NEXT_ON_PASS:
`WO-UI-005-OWNER-ACCEPTANCE.md`

NEXT_ON_BLOCK:
Fix the visible Mission Control defect. Do not create backend/schema/orchestration work merely to increase the number of live Spaces.