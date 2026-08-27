# 24 — Experience V2 Current Frontend Cutover Map

## Finding

Current `main` contains two partially competing frontend architectures that each solved a real problem and each now falls short of Experience V2 if treated as the terminal composition.

### Legacy/current Workbench composition

Strengths worth preserving:

- persistent Project/Thread context;
- Inspector and Execution-panel primitives;
- spatial restoration;
- status bar / ambient system truth;
- one action registry / Ctrl+K foundation;
- durable Thread projection;
- explicit owner-decision surfaces;
- Project/resource object model;
- direct system truth projection and compatibility routes.

Composition problems already identified by #921 / Experience V2:

- HOME / PROJECTS / ACTIVITY / SYSTEM can become page/navigation ontology rather than semantic worlds;
- Thread/timeline can dominate the center even when a real working object should dominate;
- infrastructure/work may be described rather than directly embodied;
- compatibility capability surfaces can leak internal module taxonomy.

### Current Environment composition

Strengths worth preserving:

- one persistent conversational operating language (`The Line`);
- real working surfaces dominate once present;
- no explanatory/card dashboard composition;
- meaningful WorkingWorldSnapshot separated from chrome;
- restoration stores intent/resources/artifacts/agent work/open concerns/failures/decisions/validation/conversational position, not pixel layout;
- browser/runtime surfaces can be isolated from owner credentials;
- preserved surface meaning/pinning and continuation state.

Composition problems revealed by Experience V2:

- empty state is still a blank assistant prompt (`What are we working on?`), not re-entry into a persistent personal world;
- the visible Environment currently understands mainly conversation + browser/trace surfaces, not the full operating-system object graph;
- SYSTEM/fabric/resources are not first-class spatially operable worlds;
- appended panes alone are insufficient for semantic zoom, direct system operation, Inspector, HUD/overlay, object command, or personal/professional context boundaries;
- removing chrome also removed useful orientation/control primitives;
- `The Line` risks becoming the universal interface rather than the universal language.

## Controlling resolution

Do **not** select either current composition wholesale.

Do **not** build a third independent shell beside them.

Experience V2 should converge by preserving the strongest primitives and superseding composition:

- `WorkingWorldSnapshot` / Environment meaning model becomes a key semantic working-world projection, not a complete UI ontology and not a replacement for canonical Project/Thread/Decision/Work/Evidence state.
- Workbench spatial/state primitives (restoration, selection, Inspector/Execution concepts, action registry, system truth) are reusable UI mechanics where they fit, not proof that the old Workbench composition survives.
- Canonical WilliamOS objects remain backend-owned; both Workbench and Environment projections adapt to them.
- The terminal root is one Experience V2 Environment capable of semantic worlds, direct objects, contextual working surfaces, System operation, re-entry, Inspector, HUD/overlay, command, voice/conversation and progressive technical detail.

## Reuse classification

### REUSE / EXTEND

1. `WorkingWorldSnapshot` meaning/chrome separation.
2. Environment durable world/endpoint/evidence/restoration backend where current truth confirms it.
3. Project/resource/Thread canonical objects.
4. Thread durable conversation and work projections.
5. Workbench no-focus/restoration state reducers where they remain generic.
6. Workbench Inspector concept, generalized to any selected object.
7. Workbench Execution panel concept, contextual rather than permanently Thread-centric.
8. `workbenchActionRegistry` concept, generalized from navigation registry into object + action + command registry.
9. System truth semantics (`live/persisted/inferred/unknown`) and canonical node roles.
10. device auth / HERMES hosting / constrained Tauri bridge.
11. Environment runtime surfaces and credential isolation.

### SUPERSEDE COMPOSITION ONLY

1. Home as an empty/default dashboard or new-chat state -> re-entry/world state.
2. Four fixed left-edge modes as terminal navigation ontology -> semantic world/context navigation while preserving useful shortcuts.
3. Thread timeline as universal center -> selected real object/working surface may dominate.
4. Current `/environment` blank-dialog-first shape -> restore meaningful world before offering blank creation.
5. Current surface append grid as the whole spatial model -> semantic zoom + workspace + selected object + adaptive surfaces.
6. System read-only card/page composition -> live first-class System world over real objects and governed actions.
7. capability pages as primary destinations -> compatibility/deep-detail/contextual technical surfaces.

### GENUINELY MISSING / NEEDS PROOF

1. semantic World registry/context model over Project/System/personal/professional domains;
2. selected-object contract shared by work and system objects;
3. generalized ObjectInspector projection/action contract;
4. real System Fabric topology/resource graph UI;
5. ambient/HUD overlay using the same truth/action registry;
6. global object/action search beyond static navigation labels;
7. re-entry projection (`where I was / what changed / needs me / alive now`);
8. semantic Thread map;
9. attention-class projection;
10. context compartments and cross-world policy enforcement;
11. object-context natural-language referent binding;
12. direct resource actions with authority + verified post-state;
13. profile/mode policy surfaces;
14. mobile composition for status/decisions/voice/quick action;
15. accessible semantic zoom / object recognition language.

## Important correction to #921

#921 was correct to reject wrapping the frozen Workbench inside a new Environment and correct that real work should dominate over dashboards describing work.

Experience V2 does **not** reverse that decision.

It refines it:

> The legacy Workbench composition remains non-terminal, but useful Workbench primitives are not forbidden merely because they originated there. The Environment composition is also non-terminal where it collapses the OS into a conversational desk.

The terminal architecture is a synthesis at existing canonical seams, not a visual merge of two frontends.

## System-world correction

Current System page is intentionally truthful/read-only and contains valuable signal semantics, but it is an old-style panel/card composition and explicitly cannot operate the system.

Experience V2 must preserve its truth boundaries while adding separate governed action capability:

`select object -> inspect live state -> choose deterministic/natural-language action -> authority/policy gate -> execute -> observe post-state -> evidence`

Read truth must not itself mint mutation authority.

## Command correction

Current Workbench action registry is primarily static navigation/capability search. Experience V2 must evolve the same one-action-registry principle into dynamic objects and contextual commands without creating separate shortcut/button/chat implementations.

Examples:

- `p40` -> physical GPU object, current consumers, related history/actions;
- `hermes` -> node object and relevant actions;
- `terra search` -> current TerraFusion search work/artifacts/Threads;
- `drain hermes` -> governed action candidate, not mere navigation;
- `return` -> last meaningful location/world.

## Required migration order

1. Reconcile exact current owner/backend objects and open frontend PRs against this cutover map.
2. Freeze terminal composition contracts; do not visually polish either old shell.
3. Define shared selected-object + world/location + action contracts.
4. Bind WorkingWorld meaning to canonical Project/Thread/artifact/decision/evidence state rather than duplicating it.
5. Implement re-entry before new Home/new-chat composition.
6. Implement one System-object vertical slice (HERMES -> P40) using live truth + governed action + verified post-state.
7. Generalize Inspector/action registry over that object slice.
8. Add semantic Thread projection/re-entry integration.
9. Add ambient/HUD projection from the same truth/actions.
10. Extend semantic zoom/world navigation.
11. Prove mobile/keyboard/accessibility/no-focus behavior.
12. Only then perform visual/material refinement.

## First visual acceptance slice

The first Experience V2 UI proof should not be a home page.

It should prove two transitions in one installed Environment:

### Work transition

Re-enter ongoing TerraFusion work -> see current real artifact/world -> talk/act without navigating to a module -> inspect proof when desired.

### System transition

Move to SYSTEM -> select HERMES -> select P40 -> understand load/memory/temp/current consumer -> ask `why is this loaded?` -> perform one safe governed adjustment -> see verified post-state -> return to TerraFusion exactly where it was.

If either transition requires a separate product, blank new chat, infrastructure-specific admin site, or loss of foreground state, Experience V2 fails.

## Terminal rule

**Preserve backend truth and successful interaction primitives. Supersede frontend composition. Do not confuse where code came from with whether the primitive still belongs in the operating system.**
