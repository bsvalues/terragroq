# 21 — Topology Truth vs Role Intent

WilliamOS distinguishes owner-directed architectural role from live hardware/runtime observations.

Examples:

- HERMES role: resident supervisor/control-plane host.
- AEGIS role: heavy development/data worker.
- ATLAS role: durable WilliamOS state/RAG/evidence authority.
- OMEN role: cockpit/client and opportunistic accelerator.

Live evidence may show a node offline, degraded, more capable, less capable, differently addressed, or with changed hardware. Such evidence changes placement availability; it does not silently redefine the owner-directed role.

A deliberate role migration requires its own governed architecture/authority decision.

This prevents management-plane reachability or benchmark superiority from accidentally turning OMEN into a required server, ATLAS into a repository executor, or HERMES into authoritative durable state.
