# Brain Council

Brain Council is the static/read-only advisory reasoning layer.

It can help frame options, risks, assumptions, contradictions, evidence requirements, confidence, and decision packets.

## Rule

Council may recommend. Council may not execute.

Council recommendations become Work Order packets before Codex may operate. The Primary remains the authority source.

## Advisory Model

- Evidence used drives confidence.
- Missing or stale evidence lowers confidence or blocks recommendation.
- Risk escalates on auth, DB/schema, env/package, Vercel, production-write, autonomy, Hermes/MCP/worker, memory write, TerraFusion/PACS, and secrets boundaries.
- Decision packets recommend a next safe gate; they do not approve or run work.
- Work Order recommendations are handoff packets, not commands.

## Boundaries

- No runtime Council activation.
- No autonomous reasoning loop.
- No tool calls.
- No worker dispatch.
- No command execution.
- No authority grant.
- No Hermes or MCP activation.
- No memory write.
- No dynamic ingestion.
- No production write.
- No autonomous mutation.

Council output must pass through Work Orders, Evidence, Authority, and Primary approval before any action lane opens.
