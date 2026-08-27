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
- infrastructure programs unrelated to rendering/re-entry

DELIVERABLES:
1. Mission Control summon/exit.
2. Live thumbnail/projection of each actual Space with its current work surfaces.
3. Space names and current focus.
4. Active agent/session count and meaningful current activity.
5. Ability to enter a Space and restore the exact working context.
6. William ambient overview: what changed, what matters, what needs owner attention.
7. No dashboard-style KPI wall.

REFERENCE SPACES FOR FIXTURE:
- TerraFusion Build Space
- Research & Evidence Space
- Agent Operations / delegated work Space
- Review/Recovery Space

These are examples. Production should render actual Spaces.

MISSION CONTROL BEHAVIOR:
- Summon as an OS-level spatial view.
- Existing Spaces remain live.
- Re-entry should restore window positions, selected objects, and useful context.
- William may surface concise ambient guidance, e.g. `Claude found one blocking issue in TerraFusion; Research has 3 new sources; nothing else needs you.`
- Mission Control is not a task dashboard and not a system admin console.

ACCEPTANCE_CRITERIA:
- User opens Mission Control and sees at least three distinct live Spaces represented by their actual work surfaces.
- Space previews look like working environments, not cards with metrics.
- Active agents are visible as ambient state without dominating the view.
- Clicking/activating TerraFusion returns to the same source/preview/window arrangement.
- A Space with no current runtime remains visible and truthful.
- William highlights meaningful changes without generating generic notification spam.
- No fake `Home`, `System`, or `WilliamOS` Space is introduced.

VALIDATION:
- focused Space re-entry tests
- browser review from multiple Spaces
- persistence/reopen proof

REVIEW_REQUIREMENTS:
Reviewer must attack:
1. Is this just a dashboard in disguise?
2. Are previews actual Space state?
3. Does re-entry preserve place?
4. Is agent state informative rather than noisy?
5. Does Mission Control respect the OS/environment metaphor?

EVIDENCE_PATH:
`docs/product/williamos-experience-v2/prototypes/mission-control.html`

NEXT_ON_PASS:
`WO-UI-005-OWNER-ACCEPTANCE.md`

NEXT_ON_BLOCK:
Render truthful fixture Space projections and continue UI behavior unless real Space state is the only missing prerequisite.