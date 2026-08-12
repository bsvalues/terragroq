# WO-638 — Nous Hermes Agent integration review

Focused review (docs + Pilot 0 evidence) of whether Nous Research's **Hermes Agent** should be
adopted rather than reinventing an agent/inference stack, and how it fits the Vercel-retirement
architecture. Sources: Hermes Agent docs (api-server, providers, fallback-providers,
tools-runtime, kanban, features overview, SECURITY) + the lab's own Pilot 0 containment run.

## Central finding

Hermes Agent's OpenAI-compatible gateway **runs the full agent** — "handles requests with its
full toolset (terminal, file operations, web search, memory, skills)". That makes it an
excellent **worker/agent seam** and a **poor default seam for a bounded RAG/inference-only
request**. Therefore: **two seams, not one.**

```
WilliamOS RAG/chat        →  generic OpenAI-compatible inference endpoint (no tools, no agent loop)
WilliamOS governed work   →  Nous Hermes Agent (tools/subagents) under CAPG + SEA + OS containment
```

## The 10 questions

1. **Call Hermes API directly?** Yes — `hermes gateway` exposes `POST /v1/chat/completions`
   (+ `/v1/responses`, `/v1/runs`, `/v1/models`, `/v1/health`) on `127.0.0.1:8642`, bearer auth
   required even on loopback. Caveat: full agent loop, not raw inference.
2. **Point Hermes at our Ollama?** Yes — `custom` provider, `api: http://127.0.0.1:11434/v1`
   (aliases `base_url`/`url`). Proven in Pilot 0.
3. **Disable automatic provider fallback?** Primary fallback: yes, by omission (only fires when
   `fallback_providers` is configured). **But see the sovereignty correction below — this is not
   the whole story.**
4. **CAPG as `pre_tool_call` gate?** Yes — the hook exists in the dispatch path. But per Hermes'
   own SECURITY policy, in-process hooks are not a boundary: *"the only security boundary against
   an adversarial LLM is the operating system."* CAPG is defense-in-depth; OS containment is the
   control (Pilot 0 proved Hermes' native gate allows exfil/lateral).
5. **SEA deterministic edits?** Yes, as a **replacement** for Hermes' free-form editing (which
   Pilot 0 showed fails on small models), exposed as a tool / with the native file-edit toolset
   disabled.
6. **Provider selection under WilliamOS policy?** Yes — `~/.hermes/config.yaml`
   (`model.provider`, `providers.*`); WilliamOS owns the config.
7. **OMEN/HERMES/other endpoints?** Yes — multiple `custom` providers, one per node's Ollama;
   this is exactly how a multi-node council would wire.
8. **Kanban/subagents replace our machinery?** Partially, at the **execution** layer. Kanban is
   SQLite-backed (`~/.hermes/kanban.db`), durable, with CLI + REST (`/api/plugins/kanban/`) +
   event stream; subagents via `delegate_task` (isolated toolsets, 3 concurrent). Strong adopt
   candidate — but single-host, and WilliamOS authority/evidence/placement/outcome-queue/GitHub
   acceptance stays **above** it (governance creates tasks; kanban executes them).
9. **What state, where?** `~/.hermes/config.yaml`, `~/.hermes/kanban.db`, `MEMORY.md`/`USER.md`
   (+ project `AGENTS.md`/`CLAUDE.md`/`SOUL.md`), skills docs, sessions. ⚠️ skills "execute
   arbitrary Python at import time" — memory/skills are a code-execution trust surface; their
   storage must be governed/reviewed, not merely persisted.
10. **Adopt vs disable?** Adopt: gateway (agentic use), custom-Ollama wiring, `pre_tool_call`
    (CAPG), kanban, subagents, config-driven provider control. Disable/govern: auto-fallback,
    web/browser toolsets in governed paths, skills auto-import, MCP unless governed, Hermes'
    native approval gate *as a boundary*, and its free-form editing (use SEA).

## Sovereignty correction (binding)

"Primary fallback unset = sovereign" is **too narrow**. Hermes also performs **auxiliary provider
resolution** for vision, compression, and web extraction that can auto-reach OpenRouter / Nous
Portal / Codex OAuth / Anthropic, including an internal OpenRouter retry in some paths. So the
acceptance requirement is not `fallback_providers: []` — it is:

```
NO_UNAUTHORIZED_EXTERNAL_EGRESS
  primary fallback        : explicitly empty
  auxiliary providers     : explicitly local/pinned or disabled (vision, compression, web extraction)
  provider credentials    : absent unless explicitly authorized
  network                 : external egress denied by containment unless authorized
```

**Configuration is policy; network containment is enforcement.** This matches Pilot 0's proven
posture (host-enforced deny-egress was the only control that actually stopped exfil/lateral).

## Program (locked)

```
T1 — SOVEREIGN INFERENCE   WilliamOS app → generic OpenAI-compatible WILLIAMOS_AI_BASE_URL;
                            initially Ollama /v1; kill the Vercel AI Gateway + OpenAI default.
                            R1A = chat inference NOW. R1B = embeddings HELD (bake-off first).
T2 — HERMES AGENT KERNEL   Adopt Nous Hermes Agent as the governed worker/agent kernel
                            (NOT the inference server) under CAPG + SEA + OS containment;
                            acceptance = NO_UNAUTHORIZED_EXTERNAL_EGRESS above.
T3 — MODEL FABRIC          OMEN + HERMES + AEGIS + ATLAS: bake-offs, specialization, council,
                            distributed/offloaded inference.
T4 — HYBRID INTELLIGENCE   Local-first → policy decides → DeepSeek/OpenAI/Anthropic/etc. only
                            when data class + authority permit ([[williamos-provider-doctrine]]).
```

## R1B hold + Neon note

Do not freeze the embedding model or vector dimension yet. Inventory current-generation
embedding candidates, benchmark retrieval quality + HERMES/OMEN/ATLAS CPU/GPU performance, choose
the dimension, then freeze the pgvector schema. The empty ATLAS sovereign DB is the luxury that
lets us choose the vector space correctly before canonical data enters it. If Neon holds
canonical 1536-dim OpenAI vectors, we preserve the source records and **regenerate** embeddings
in the chosen space — never copy incompatible vectors across. No `DATABASE_URL` cutover until
vector-space selection and Neon classification are complete.
