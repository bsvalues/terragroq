# 28 — WilliamOS Operating Modes and Policy Bundles

## Finding

Current WilliamOS already has execution-placement policy, evidence/freshness gates, authority, bounded dispatch and runtime/provider controls. What is not yet established is a first-class owner-facing concept that composes these controls into meaningful whole-system operating modes.

The UI must not introduce magical `Quiet`, `Performance`, `Sprint` or `Local Only` switches whose behavior lives only in frontend code.

## Principle

An **OperatingMode** is a named, inspectable policy bundle over existing canonical controls. It is not a new scheduler, authority plane or hardware-control implementation.

A mode may express preferences/constraints across:

- placement scoring/preferences;
- foreground vs background priority;
- thermals/power/noise preference;
- model residency/eviction preference;
- cloud eligibility and spend ceilings;
- locality/privacy/egress constraints;
- opportunistic OMEN eligibility;
- elastic-worker eligibility;
- queue/background maintenance behavior;
- owner-attention thresholds;
- optional maintenance/update windows.

Each field must bind to an existing or explicitly new canonical policy owner. Unsupported fields remain `UNSUPPORTED`, not silently simulated.

## Candidate owner modes

Names are owner-facing product vocabulary and may evolve. Candidate V1 profiles:

- `AUTO` — evidence-driven normal operation;
- `DEVELOPMENT` — interactive responsiveness favored while preserving normal governance;
- `TERRAFUSION_SPRINT` — delivery-critical TerraFusion work receives bounded priority; unrelated background work may yield;
- `DEEP_INTELLIGENCE` — maximize admitted intelligence capability within explicit spend/privacy/thermal limits;
- `QUIET` — prefer lower noise/power/thermal load and defer nonurgent background compute;
- `MAINTENANCE` — backups, health checks, updates and data-integrity work may receive priority under existing authority;
- `LOCAL_ONLY` — hard deny external inference/elastic-compute egress unless a separate explicit owner decision changes policy.

Do not infer that a mode grants authority for cloud spend, protected-data movement, destructive maintenance, overclocking or release/cutover actions.

## Explainability

The owner must be able to ask:

- `What does Sprint change?`
- `Why did you move this workload?`
- `What would Quiet defer right now?`
- `Will Local Only break anything currently active?`

WilliamOS should answer from the concrete policy diff and current system state.

A mode switch should show meaningful consequences before crossing a genuine owner boundary.

## Scope and layering

Modes may be scoped where useful:

- whole WilliamOS fabric;
- world/Project;
- bounded time window;
- specific workload class.

More specific policy may not silently weaken stronger security/authority constraints.

## Temporary boosts

Requests such as `give TerraFusion everything we safely can for the next hour` should compile into an inspectable temporary policy overlay with explicit expiry, not mutate permanent defaults.

Expiry must be automatic and evidence-backed.

## Hardware controls

Owner-facing modes should initially prefer semantic intent over raw clocks/voltages/fan curves.

Example:

`QUIET` may request an approved lower-power/fan/performance profile where supported; it does not directly author arbitrary hardware registers.

`MANUAL/TECHNICAL` raw controls, if ever admitted, require separate hardware-specific safety/authority design.

## Acceptance

- Mode definitions resolve to explicit canonical policy fields; no frontend-only behavior.
- `What changes?` produces an exact policy diff.
- Switching modes does not mint missing authority.
- `LOCAL_ONLY` fails closed against external API/elastic placement.
- Temporary Sprint/boost expires automatically.
- Closing OMEN does not break a mode; placement recomputes safely.
- Background/attention behavior changes according to mode without stealing focus.
- Unsupported hardware/policy controls are shown honestly as unsupported.
- Reverting to AUTO restores the prior non-temporary policy baseline without losing canonical work state.
