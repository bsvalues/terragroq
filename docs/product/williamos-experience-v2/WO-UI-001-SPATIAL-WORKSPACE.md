# WO-UI-001 — Spatial Workspace and Window Manager

PROGRAM: `WILLIAMOS_EXPERIENCE_V2`
GOAL: Deliver the first unmistakably WilliamOS working Space.
LOOP: `UI_PRODUCT`
STATUS: `READY`
RISK_CLASS: `UI_ONLY`
DEPENDS_ON: none

PURPOSE:
Replace the current provisional shell with the final spatial product behavior: durable Space + serious independent work surfaces + restrained window manager.

CURRENT_TRUTH:
- Real TerraFusion repo/file/editor/save/tabs/splits/preview mechanics already exist.
- Current UI lineage has repeatedly drifted between toy floating windows and fixed IDE columns.
- The final target is neither. WilliamOS needs a real spatial window manager with serious persistent work surfaces.

ALLOWED_FILES_OR_AREAS:
- `components/workspace-shell/**`
- `components/desk/**`
- UI-only helpers under `lib/environment/**` when directly required for layout/persistence
- focused UI tests
- `docs/product/williamos-experience-v2/**`

ALLOWED_ACTIONS:
- React/UI implementation
- CSS/layout/windowing
- browser fixtures
- direct browser acceptance
- focused test changes that encode this product contract

BLOCKED:
- HERMES/orchestration changes
- database/schema work
- authority/grant redesign
- TerraFusion backend/business UI changes
- deployment architecture

DELIVERABLES:
1. Durable TerraFusion Space.
2. Independent Source, Developer Preview, Terminal/Test/Diff/Inspector surfaces.
3. Real window behaviors: move, resize, minimize/restore, z-order/focus, persistence, useful snapping/layout.
4. Chrome that recedes behind the work.
5. No fixed dashboard grid as the only layout.
6. No old toy floating-window visual language.
7. Selected object state available for downstream AI affordances.

PRODUCT LAWS:
- WilliamOS is the environment itself.
- Space is the durable context.
- The workspace is the product; there is no Home dashboard.
- TerraFusion is software being developed, not WilliamOS business UI.
- Large real work surfaces dominate.
- Windowing must feel like a professional OS, not draggable cards.

ACCEPTANCE_CRITERIA:
- Open TerraFusion Space.
- Source, preview, and at least one additional serious work surface can coexist.
- User can rearrange work without losing state.
- Close/reopen restores Space and useful surface state.
- Preview remains target software under development.
- No permanent chat panel is required to use the Space.
- At 1440px+ the environment feels spatial and intentional, not like a three-column website.
- At narrower widths surfaces remain usable through responsive/snap behavior without collapsing product identity.
- Browser visual review confirms the result is materially different from the old obsidian/copper mini-desktop and from generic VS Code.

VALIDATION:
- focused Vitest/JSDOM for persistence and interaction
- production build
- direct desktop browser review
- direct reduced-width browser review

REVIEW_REQUIREMENTS:
Reviewer must attack:
1. Does this flatten into a fixed IDE layout?
2. Are windows merely cards with drag handles?
3. Is useful work subordinate to chrome?
4. Did any TerraFusion business workflow leak into WilliamOS?
5. Does restoration preserve real place?

STOP_CONDITIONS:
Stop only if the implementation would require a product-boundary change. Do not stop for a discovered infrastructure defect that can be truthfully fixtured.

EVIDENCE_PATH:
`docs/product/williamos-experience-v2/prototypes/workspace.html`

NEXT_ON_PASS:
`WO-UI-002-WILLIAM-AND-AGENTS.md`

NEXT_ON_BLOCK:
Record the smallest UI blocker and continue every independent UI task.