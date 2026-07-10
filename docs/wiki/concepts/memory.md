# Memory / Brain Memory Spine

Memory is WilliamOS continuity context. The Brain Memory Spine defines how that
continuity is represented as governed, source-aware, sensitivity-aware, and
authority-gated records.

It can represent facts, decisions, procedures, patterns, contradictions, stale
items, review queue items, evidence summaries, trace links, Council references,
and authority summaries so future work can begin with context instead of
guessing.

## Governing Rules

- Memory can be stale or contradicted.
- Memory needs source, evidence, confidence, sensitivity, and review state.
- Memory does not equal uncontrolled truth.
- Memory does not grant authority.
- Memory writes, retrieval expansion, vector stores, embeddings, and canon
  promotion require separate governance.
- Memory must not contain secrets, raw protected data, or PACS/private material.
- Brain Council may reference memory as static context only.
- Trace/Eval may link memory as proof history only.
- Hermes, MCP, workers, and Agent Forge cannot consume memory in this lane.

Memory guides review. It does not execute work.

## Core Record Types

- Fact Memory
- Decision Memory
- Procedure Memory
- Pattern Memory
- Contradiction Memory
- Stale Memory
- Review Queue Item
- Authority Memory
- Evidence-Linked Memory
- Trace-Linked Memory
- Council-Referenced Memory
- Future Skill/Forge-Referenced Memory

## Safe Default

When memory is stale, contradictory, sensitive, or missing evidence, the safe
default is review before trust and no action without a bounded Work Order.
