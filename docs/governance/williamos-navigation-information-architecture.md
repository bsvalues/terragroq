# WilliamOS Navigation & Information Architecture

Work order: WO-SHELL-002
Title: Navigation & Information Architecture
Type: Architecture / Product Doctrine
Risk: Low, documentation and planning only

## Purpose

This document translates the WilliamOS Unified System Architecture into a
practical navigation and information architecture model for the app.

This work order does not authorize runtime behavior changes, route moves, UI
implementation, database changes, auth behavior changes, Vercel changes, or
agent activation.

## Base

WO-SHELL-002 follows:

- WO-AUTH-006H: Primary Operator / private command environment language.
- WO-SHELL-001: WilliamOS Unified System Architecture.
- Base main: `89810886144b2fd053119ef1f2e6bfaed4a9d993`.

## Current Route Inventory

This inventory describes current URL paths, not final UI labels.

### Auth and access routes

- route: `/operator` - operator entry shell and Primary Operator access
  orientation.
- route: `/sign-in` - existing sign-in behavior.
- route: `/sign-up` - bootstrap-gated sign-up behavior.
- route: `/setup` - local setup assistant.

### Primary shell routes

- route: `/` - current Command Overview.
- route: `/goal-console` - goal classification and next objective surface.
- route: `/work-orders` - governed work drafting and work order state.
- route: `/chat` - operator chat with project context.
- route: `/decisions` - decision register.
- route: `/doctrine` - doctrine and rule register.
- route: `/governance` - authority, locks, and governance overview.
- route: `/brain-council` - Brain Council reasoning, readiness, research, and Hermes
  preview surfaces.
- route: `/memory` - memory facts and durable context.
- route: `/corpus` - corpus/source material index.
- route: `/audit` - audit/event history.
- route: `/runtime` - runtime and system health.

### API and system routes

- route: `/api/health` - production/runtime health.
- route: `/api/auth/readiness` - auth readiness and signup posture.
- route: `/api/auth/origin-diagnostics` - trusted origin diagnostics.
- route: `/api/auth/[...all]` - Better Auth handler.
- route: `/api/chat` - chat route.
- route: `/api/copilot/runtime` - runtime metadata.
- route: `/api/setup/local-status` - local setup status.
- route: `/api/setup/local-config` - local setup configuration.

## Current Navigation Model

The current shell groups navigation into:

- Command
- Governance
- Knowledge
- Operations

Current top-level labels include Overview, Goal Console, Work Orders, Operator
Chat, Decisions, Doctrine, Governance Overview, Brain Council, Memory, Corpus,
Audit Log, and Runtime.

This is functional but does not yet fully match the permanent WilliamOS
architecture. It still exposes some implementation-era categories and does not
yet make Projects, Hermes, Agent Forge, Evidence, Authority, and Systems feel
like first-class rooms in one environment.

## Proposed Primary Navigation

The primary navigation should converge on these permanent areas:

1. Home
2. Projects
3. Work Orders
4. Evidence
5. Brain Council
6. Hermes
7. Agent Forge
8. Memory
9. Governance
10. Authority
11. Systems

This is the operator-facing navigation model. It should not mirror every route
or implementation module one-for-one.

## Proposed Secondary Navigation

### Home

Purpose: Primary Operator status briefing.

Secondary areas:

- Attention
- Stable
- Blocked
- Recommended Next Move
- Recent Evidence
- System Readiness

Current route mapping:

- Keep `/` as Home.
- Rename "Command Overview" to "Home" or "Primary Home" during implementation.
- Keep quick links, but align them to the permanent areas.

### Projects

Purpose: operational systems and efforts under command.

Secondary areas:

- Project overview
- Active context
- Open Work Orders
- Evidence
- Memory
- System links

Current route mapping:

- No dedicated route exists yet.
- Add `/projects` later.
- Existing chat/project context should eventually become a secondary project
  function, not a primary system identity.

### Work Orders

Purpose: governed change model.

Secondary areas:

- Draft
- Review
- Validation
- PR / Merge
- Completed
- Blocked

Current route mapping:

- Keep `/work-orders`.
- Fold `/goal-console` into Work Orders or Home as "Next Objective" unless it
  remains important enough to be its own primary surface.

### Evidence

Purpose: factual proof of claims.

Secondary areas:

- Validation
- Production verification
- Deployment records
- Readiness reports
- Decision evidence

Current route mapping:

- No dedicated Evidence route exists yet.
- `/audit`, `/runtime`, and portions of Brain Council currently carry evidence.
- Add `/evidence` later and make Audit Log a secondary Evidence view.

### Brain Council

Purpose: strategic reasoning and advisory synthesis.

Secondary areas:

- Reasoning
- Research Mode
- Experiments
- Predictions
- Assumptions
- Unknowns
- Decision quality
- Readiness evaluation

Current route mapping:

- Keep `/brain-council`.
- Use it as the primary Brain Council room.
- Keep Hermes content preview-only if surfaced here.

### Hermes

Purpose: governed execution subsystem.

Secondary areas:

- Worker Dock
- Readiness
- Sandbox requirements
- Activation boundaries
- Procedure candidates
- Execution evidence

Current route mapping:

- No dedicated `/hermes` route exists yet.
- Hermes content currently appears as preview/research material in Brain
  Council.
- Add `/hermes` only when the UI needs a separate execution-readiness room.
- Do not imply Hermes is active unless authorization and runtime work exist.

### Agent Forge

Purpose: agent definition and capability management.

Secondary areas:

- Agent definitions
- Capability cards
- Prompt/spec lifecycle
- Quarantine
- Approval state

Current route mapping:

- No dedicated route exists yet.
- Agent Forge should not be presented as execution runtime.
- Add `/agent-forge` when capability lifecycle views become useful.

### Memory

Purpose: continuity and durable knowledge.

Secondary areas:

- Durable facts
- Decisions
- Doctrine
- Preferences
- Historical context
- Retrieval sources

Current route mapping:

- Keep `/memory`.
- Keep `/corpus` as a secondary Memory or Evidence surface.
- Cross-link `/decisions` and `/doctrine`, but do not make Memory their primary
  home. Decisions and Doctrine are governance records that Memory may reference.

### Governance

Purpose: rules, doctrine, locks, and policy.

Secondary areas:

- Doctrine
- Decisions
- Locks
- Guardrails
- Work Order policy
- Goal / loop governance

Current route mapping:

- Keep `/governance` as the governance overview.
- Keep `/doctrine` as a secondary Governance surface.
- Keep `/decisions` as a secondary Governance surface. Decision records are
  evidence-backed governance objects that Memory can reference.

### Authority

Purpose: who or what is allowed to do what.

Secondary areas:

- Primary Operator
- Access Grants
- Approval requirements
- Recovery posture
- Execution authority
- Denied actions

Current route mapping:

- No dedicated `/authority` route exists yet.
- Auth and access-grant doctrine currently live in documents.
- Add `/authority` when access grants or approval state become visible.

### Systems

Purpose: operational health and readiness.

Secondary areas:

- Runtime
- Authentication
- Deployment
- Environment
- Security headers
- Diagnostics

Current route mapping:

- Rename `/runtime` conceptually into Systems / Runtime.
- Keep `/setup` outside the authenticated shell until setup becomes a Systems
  sub-view.
- Keep health and readiness API routes as Systems evidence.

## Post-Login Landing Model

After sign-in, the Primary Operator should land on Home.

Home should answer:

- What needs attention?
- What changed?
- What is stable?
- What is blocked?
- What is the recommended next move?

Home should not become a dense analytics dashboard. It should act like a calm
briefing that routes the Primary Operator into the correct room.

Recommended primary cards:

- Attention
- Next Move
- Work in Progress
- Evidence
- System Readiness
- Brain Council Advisory

## Placement Decisions

- Home / Command Center: `/`, renamed from Command Overview toward Home.
- Work Orders: primary top-level area.
- Evidence: new top-level area, backed by audit, validation, runtime, and
  production checks.
- Brain Council: primary top-level area, advisory and research only.
- Hermes Worker Dock: future Hermes area, preview/readiness first, execution
  only after authority gates.
- Agent Forge: future area for capability definitions and lifecycle.
- Projects: future area for real operational systems under command.
- Memory / Knowledge / Doctrine: Memory and Governance should split durable
  context from policy/rules.
- Governance: policy, doctrine, locks, decision discipline.
- Authority / Access Grants: separate from Governance once access grants become
  implemented.
- Runtime / System Health: Systems area.

## Naming Recommendations

Recommended current-to-target naming:

- label: Overview -> Home
- label: Command Overview -> Primary Home
- label: Operator Chat -> Ask WilliamOS or Operator Query
- label: Goal Console -> Next Objective or Goal Console under Work Orders
- label: Governance Overview -> Governance
- label: Audit Log -> Evidence / Audit
- label: Runtime -> Systems / Runtime
- label: Corpus -> Memory / Corpus
- label: Decisions -> Governance / Decisions
- label: Doctrine -> Governance / Doctrine

These are label recommendations. They do not imply route renames unless a future
implementation work order explicitly authorizes routing changes.

Avoid introducing product names that compete with WilliamOS. Brain Council,
Hermes, and Agent Forge are subsystem names, not separate applications.

## Routes To Keep, Rename, Group, Or De-Emphasize

### Keep

- `/`
- `/operator`
- `/sign-in`
- `/sign-up`
- `/work-orders`
- `/brain-council`
- `/memory`
- `/governance`
- `/runtime`

### Rename in UI only first

- `/` label: Overview -> Home
- `/runtime` label: Runtime -> Systems
- `/audit` label: Audit Log -> Evidence / Audit
- `/chat` label: Operator Chat -> Ask WilliamOS

### Group before moving routes

- `/decisions` under Governance or Memory
- `/doctrine` under Governance
- `/corpus` under Memory
- `/goal-console` under Work Orders or Home

### Add later

- `/projects`
- `/evidence`
- `/hermes`
- `/agent-forge`
- `/authority`

Future route readiness criteria:

- Add `/projects` only when there is a project context model or useful
  project-specific aggregation to show.
- Add `/evidence` only when at least two existing evidence sources can be
  unified into one proof-oriented surface.
- Add `/hermes` only when Hermes readiness, sandbox, or worker-dock state needs
  a dedicated room. Do not add it to imply runtime activation.
- Add `/agent-forge` only when agent definitions, capability cards, lifecycle,
  or quarantine state need a dedicated room.
- Add `/authority` only when access grants, approval state, denied actions, or
  execution authority become visible enough to warrant a first-class surface.

### De-emphasize

- Standalone chat as a primary identity. Chat should be an input method, not the
  center of WilliamOS.
- Generic dashboard framing. Home is a status briefing, not a business
  dashboard.

## First Implementation Queue

1. WO-SHELL-003 - WilliamOS Home / Command Center Shell
   - Rename the visible home concept.
   - Reframe Home as a Primary Operator status briefing.
   - Keep existing data and behavior.

2. WO-SHELL-004 - Sidebar Navigation Label Alignment
   - Update navigation labels and group language.
   - Avoid route moves.
   - Preserve shallow navigation.

3. WO-SHELL-005 - Evidence Area Design
   - Design or add `/evidence` as a factual proof surface.
   - Start with existing audit/runtime/validation sources.

4. WO-SHELL-006 - Projects Context Model
   - Design the first Projects model without database mutation.
   - Separate project context from generic chat.

5. WO-SHELL-007 - Authority Surface Design
   - Make Primary Operator, access grants, denied actions, and approval
     requirements visible.
   - Keep behavior unchanged.

6. WO-SHELL-008 - Hermes / Agent Forge Placement Plan
   - Define when Hermes and Agent Forge deserve first-class routes.
   - Preserve no-runtime and no-autonomy boundaries.

## Validation Requirements For Future IA Work

Every implementation work order that follows this document should prove:

- The Primary Operator can still reach major areas within two interactions.
- The UI does not imply teams, organizations, public signup, or SaaS onboarding.
- Brain Council remains advisory unless explicitly authorized otherwise.
- Hermes remains inactive unless authority gates and runtime implementation
  explicitly allow activation.
- Evidence distinguishes facts from recommendations.
- Systems surfaces operational readiness without becoming the main product
  identity.

## Safety Posture

WO-SHELL-002 is documentation-only. It does not change runtime behavior, auth
policy, database schema, environment configuration, package dependencies,
deployment settings, Hermes, MCP, Brain Council autonomy, or production-write
behavior.
