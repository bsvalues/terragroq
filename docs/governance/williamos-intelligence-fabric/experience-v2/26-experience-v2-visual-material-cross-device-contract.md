# 26 — Experience V2 Visual, Material, and Cross-Device Contract

## Finding

Current `main` already contains useful visual foundations:

- a restrained dark workbench palette with copper/live/warning/fault semantics;
- reduced-motion handling;
- explicit focus treatment;
- serious-tool density rather than oversized marketing typography;
- mobile-pane/restoration state in the Workbench reducer.

But the repository also still carries two competing visual/composition families:

1. older generic card/sidebar/shell primitives and shadcn/Tailwind defaults;
2. the newer Environment's deliberately stripped neutral-black conversation/desk surface.

Neither current family is the terminal visual language for Experience V2.

## Product visual thesis

WilliamOS should feel like a persistent, inhabited operating environment: calm, high-information, spatially stable, technically serious, and alive through real state. It must not visually advertise AI, gaming, dashboards, or sci-fi.

Borrow from modern macOS only at the level of hierarchy/material behavior: content/world first, chrome/control as a distinct receding layer, restrained depth/translucency, strong continuity across devices. Do not imitate decorative Liquid Glass everywhere.

## Material hierarchy

Use material/depth to communicate semantic layering:

1. **World/content plane** — the actual artifact, system topology, document, code, data, machine or work surface; primarily opaque and stable.
2. **Object selection / inspector plane** — contextual control and detail; subtly separated from the world.
3. **OS chrome plane** — navigation, status, command/overlay; visually recedes when not active.
4. **Transient attention plane** — HUD, owner-decision prompt, warning; appears only when relevant.

Translucency/blur is optional and restrained. It may never reduce readability, evidence truth, status contrast or target clarity.

## Anti-slop visual rules

Reject by default:

- card-grid homepages;
- equal-weight rounded containers for unrelated information;
- gradient/glow backgrounds used to imply intelligence;
- animated AI orbs/avatars as the primary metaphor;
- excessive pills/chips;
- giant headings and sparse marketing whitespace in operational surfaces;
- rainbow status systems;
- decorative waveform/particle activity that is not tied to real work;
- every region having a visible border merely because it is a component;
- raw Tailwind/shadcn defaults becoming product identity;
- generic chat bubbles as the dominant representation of a long-lived world.

## Information density

WilliamOS is allowed to be information-dense. Requirements:

- hierarchy must make the primary subject obvious within seconds;
- secondary metadata is quieter but readable;
- typography, indentation, alignment and whitespace do more grouping than boxes;
- stable object position matters more than novelty;
- dense metrics include meaning/cause/trend access, not just numbers;
- human labels precede hashes/UUIDs; technical identity is progressive disclosure.

## Object identity

Stable first-class objects should develop recognizable visual identity without becoming cartoonish brands.

Examples: HERMES, AEGIS, ATLAS, OMEN, P40, storage volumes, Projects/worlds.

Recognition may combine:

- stable placement;
- glyph/shape;
- concise human name;
- role/status treatment;
- topology relationship.

Do not rely on color alone.

## Temporal state

Important system/resource objects should support `NOW / TREND / HISTORY / CAUSE` as one visual grammar. Current values without trend/context are insufficient for diagnosing meaningful behavior.

Activity is represented through restrained stateful motion only when it maps to real work: active data flow, model loading, execution progress, resource pressure, or state transition. Reduced-motion preference must preserve meaning without motion.

## Conversation

Conversation remains available everywhere but does not visually consume the environment when another object is primary.

Long-lived interaction should favor contextual conversation integrated with the current world/object. Avoid permanent oversized chat transcript layouts when the semantic map/artifact/system object is the useful primary representation.

## Cross-device doctrine

Different devices are surfaces into the same canonical world, not separate product editions.

### Desktop / OMEN

Full spatial environment: semantic world, direct manipulation, Inspector, System topology, command, HUD, deep technical access.

### Large tablet / iPad

Near-full environment with touch-appropriate composition: semantic zoom, Inspector as adaptive side sheet/pane, strong direct manipulation, voice, stylus/file/document workflows where useful. Do not simply scale desktop chrome down.

### Phone

Prioritize:

- re-entry/current world;
- `Needs you` decisions;
- alerts/attention;
- ambient System/Fabric state;
- conversation/voice;
- quick deterministic actions;
- evidence/approval inspection;
- remote continuation/steering.

Phone is not the primary topology administration or multi-pane coding surface, but must still preserve world identity and continuity.

### HUD / overlay

Fast ambient state, contextual command/ask, safe quick actions, and expand-to-exact-object behavior. It is a projection, not a mini application.

## Responsive semantics

Do not treat responsive design as `desktop columns -> stacked cards`.

Preserve semantic relationships while changing composition. For example, Desktop `world + inspector` may become tablet `world + slide-over inspector` and phone `world -> inspector drill-in`, all retaining the same selected object and canonical state.

Current Workbench mobile-pane/restoration mechanics are predecessor implementation evidence, but `explorer/thread/inspector/execution` are not frozen as terminal mobile ontology.

## Accessibility and personalized cognition

- readable prose line lengths;
- high contrast and explicit focus;
- strong differentiation between headings/body/metadata/technical IDs;
- no status conveyed only through subtle hue/transparency;
- keyboard-first desktop operation remains strong;
- touch targets meet mobile/tablet needs;
- screen-reader semantics map to real objects/actions;
- reduced motion is first-class;
- visual stability is prioritized during background refresh;
- transient surfaces do not steal focus unless attention policy permits.

Do not implement a reductive `ADHD mode` or `dyslexia theme`. The base experience should already favor recognition, hierarchy, stable positioning, and reduced reconstruction cost. Personalizable density/type/contrast settings may exist and remain inspectable.

## Theme and personalization

Theme is not the main personalization system. Support dark/light/system or other appearance choices only after semantic hierarchy works. Product identity must survive theme changes.

User customization may eventually include pinning HUD metrics, preferred density, font sizing, Control Center composition and world favorites, but customization must not fork the object/action model.

## Required visual proof set

Before declaring Experience V2 visual direction accepted, render and test the same canonical state in at least:

1. Desktop TerraFusion world with active work + Inspector.
2. Desktop SYSTEM -> HERMES -> P40 object.
3. Re-entry Home/world state with `what changed / needs you / alive now`.
4. HUD overlay over a non-WilliamOS foreground application.
5. iPad/tablet adaptation of one work world and one System object.
6. Phone re-entry + owner-decision + quick System status.
7. degraded/offline/stale states without pretending healthy-live.
8. reduced-motion/high-text-size cases.

Use real/synthetic canonical object data, not marketing lorem ipsum.

## Failure test

The visual system fails if screenshots can be plausibly mistaken for:

- a generic AI chat SaaS;
- a shadcn admin template;
- a gaming utility;
- a Grafana/Proxmox clone;
- a marketing concept dashboard.

The desired reaction is: **this is one coherent operating environment with real things in it.**
