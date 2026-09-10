# WO-UI-003 — Brain Council as Summonable Strategic Intelligence

PROGRAM: `WILLIAMOS_EXPERIENCE_V2`
GOAL: Make Brain Council a real high-value advisory experience without turning it into a permanent dashboard.
LOOP: `UI_PRODUCT`
STATUS: `READY`
RISK_CLASS: `UI_ONLY`
DEPENDS_ON: `WO-UI-002-WILLIAM-AND-AGENTS`

PURPOSE:
Give the owner a powerful way to summon multiple perspectives, debate tradeoffs, inspect evidence, and reach a decision while staying inside the current Space.

CURRENT_TRUTH:
- Brain Council remains part of the desired WilliamOS experience.
- It is advisory, not an execution authority and not a permanent navigation destination.
- The latest renderings show the right direction: multiple roles, live collaboration, dissent, recommendation, evidence, and handoffs.

ALLOWED_FILES_OR_AREAS:
- Experience V2 Council surfaces/components
- Line summon integration
- contextual overlay/window UI
- UI adapters over existing advisory/session state
- fixtures and focused tests

BLOCKED:
- new reasoning/orchestration engine
- new authority model
- new permanent Council dashboard/home page
- silently executing Council recommendations

DELIVERABLES:
1. `Council this` from The Line or selected object.
2. Brain Council appears as a serious summonable work surface/window inside the current Space.
3. Multiple council members with role + provider/model metadata.
4. Live perspectives and handoffs.
5. Consensus + dissent + blind spot + recommendation.
6. Evidence pack / links to source evidence.
7. Owner actions: request changes, reject, approve recommendation, ask for dissent, run another pass.
8. Session can be dismissed without destroying the current Space.

COUNCIL ROLES FOR FIXTURE/REFERENCE:
- Architect
- Verifier
- Operator
- Researcher
- Recovery/Risk lead

The actual provider may vary. Role is the product concept.

COUNCIL EXPERIENCE:
The owner asks a real question, e.g.:

`Council the current UX before we merge.`

The surface should show:
- question in focus
- member statuses
- active debate/collaboration
- areas of agreement
- strongest dissent
- identified blind spot
- recommendation and confidence
- evidence backing important claims

ACCEPTANCE_CRITERIA:
- Council can be summoned from current Space without navigating away.
- Council visibly understands current selected context.
- At least one dissenting perspective is representable.
- Consensus is not faked by hiding disagreement.
- Recommendation links back to evidence and current work.
- Council never becomes a permanent full-screen home/dashboard requirement.
- Council actions do not imply authority they do not have.
- Dismissing Council returns the owner to the exact working place.
- Visual result feels like strategic intelligence, not a row of chatbot cards.

VALIDATION:
- browser review of summon/dismiss/re-entry
- focused tests for context binding and state retention
- no regression to core workspace/window state

REVIEW_REQUIREMENTS:
Reviewer must attack:
1. Is this advisory or secretly executable?
2. Does it feel like five chatbots pasted together?
3. Can owner see dissent and evidence?
4. Does Council preserve place on dismissal?
5. Is Council optional/summonable rather than default chrome?

EVIDENCE_PATH:
`docs/product/williamos-experience-v2/prototypes/brain-council.html`

NEXT_ON_PASS:
`WO-UI-004-MISSION-CONTROL.md`

NEXT_ON_BLOCK:
Use a truthful static advisory fixture and finish the interaction/visual behavior first.