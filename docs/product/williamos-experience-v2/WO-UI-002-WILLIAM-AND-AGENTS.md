# WO-UI-002 — William Presence, The Line, and Durable Agents

PROGRAM: `WILLIAMOS_EXPERIENCE_V2`
GOAL: Make the AI power obvious, direct, and usable without turning WilliamOS into a chatbot.
LOOP: `UI_PRODUCT`
STATUS: `READY`
RISK_CLASS: `UI_ONLY`
DEPENDS_ON: `WO-UI-001-SPATIAL-WORKSPACE`

PURPOSE:
Put living intelligence into the environment. The owner must be able to work with William and multiple agents from the current Space and selected object without navigating to a generic Agents dashboard.

CURRENT_TRUTH:
- The renderings finally show the right direction: William presence, active agent sessions, object-level AI actions, and The Line.
- Current implementation underrepresents agent collaboration and William's ego/presence.
- Provider identity must remain separate from WilliamOS identity.

ALLOWED_FILES_OR_AREAS:
- Experience V2 UI components
- agent/session presentation components
- Line/context/Inspector UI
- UI-only adapters over existing session/work state
- focused tests and truthful fixtures

BLOCKED:
- building a new agent runtime
- new queue/orchestration architecture
- new provider routing system
- fake claims of autonomous work when no live state exists

DELIVERABLES:
1. Persistent William presence that follows the owner across Spaces.
2. The Line as transient universal command/input infrastructure.
3. Active agent presence attached to the Space.
4. Durable session objects with role first, provider second.
5. Object-level AI affordances.
6. Agent detail/summon surface that does not become the whole Space.
7. Clear truthful distinction between live state and fixture/demo state.

WILLIAM EGO CONTRACT:
William is calm, confident, opinionated, proactive, and aware of the work.

Good examples:
- `This interaction is weak. I spun up two alternatives.`
- `Claude found one issue I agree with.`
- `I would not merge this yet.`
- `Option B is cleaner. Council can challenge me if you want.`

Bad examples:
- generic encouragement
- fake emotional theater
- anthropomorphic face/avatar as the main metaphor
- constant chatter
- pretending a model provider is William

AGENT MODEL:
An agent session has at minimum:
- durable session identity
- role (builder, reviewer, researcher, local execution, etc.)
- provider/model metadata
- current assignment
- status/progress
- current evidence/output link
- actions appropriate to state

NORMAL SPACE PRESENCE:
Compact examples:
- `Builder · Codex · implementing · 6 files`
- `Reviewer · Claude · 2 findings`
- `Local · HERMES · tests running`

OBJECT ACTIONS:
File: `Ask · Change · Delegate · Review`
Preview: `Inspect · Debug · Explain · Delegate`
Diff: `Review · Improve · Challenge · Merge`
Agent: `Talk · Redirect · Pause · Fork · Review work`
Space: `Summarize · Continue · Delegate · Council`

ACCEPTANCE_CRITERIA:
- With a TerraFusion file selected, user can invoke Ask/Change/Delegate/Review without restating what file they mean.
- Ctrl+K summons The Line and current context is visible.
- User can direct a named/role agent from The Line.
- User can see at least three concurrent agent sessions and what each is doing.
- Agent presence does not consume a permanent giant sidebar by default.
- William can surface a proactive judgment tied to inspectable state.
- User can accept, inspect, override, or route William's recommendation.
- Provider labels never replace WilliamOS identity.
- UI feels alive even when no conversation pane is open.

VALIDATION:
- focused interaction tests
- browser review with agents active
- browser review with agents idle
- keyboard navigation for Ctrl+K and object action menus

REVIEW_REQUIREMENTS:
Reviewer must attack:
1. Is AI actually operable or merely represented?
2. Did this become ChatGPT beside an IDE?
3. Are agent cards merely status wallpaper?
4. Does William have a coherent voice and ego without becoming gimmicky?
5. Is context automatically carried from selected objects?

EVIDENCE_PATH:
`docs/product/williamos-experience-v2/prototypes/workspace.html`

NEXT_ON_PASS:
`WO-UI-003-BRAIN-COUNCIL.md`

NEXT_ON_BLOCK:
Use truthful session fixtures and continue UI work unless the exact interaction cannot be represented without new backend state.