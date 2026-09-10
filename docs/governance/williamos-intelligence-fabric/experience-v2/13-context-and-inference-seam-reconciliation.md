# 13 — Context and Application Inference Seam Reconciliation

## Purpose

Prevent IF-04 and IF-06 from rebuilding Thread persistence, conversation ownership, or the application-facing inference client that current main already provides.

## Current-main foundations

### Durable Thread conversation

`lib/workbench/thread-conversation.ts` defines the conversational core of a WilliamOS Thread. It:

- treats conversation as primary Thread content;
- checks ownership on every Thread call;
- persists ordered owner/WilliamOS messages;
- bounds message count/length;
- keeps internal work/governance vocabulary out of normal owner interaction.

`app/api/thread-chat/route.ts` persists the owner's message **before** model execution, then rebuilds model history from the persisted `workbenchThreadMessage` store rather than trusting the transient browser conversation. This already makes the durable WilliamOS Thread the source of conversation truth for that path.

### Durable work/context projection

`app/actions/workbench-threads.ts` already projects a Thread over explicit Project/root/member bindings plus Goal, Outcome, Work Order, Decision, Evidence, Governance and Audit records with user scoping. This is a strong precursor to Context Fabric source selection; Context Fabric should compile these canonical stores rather than create a generic duplicate chat/task database.

### Application inference seam

`lib/ai/provider.ts` exposes a generic OpenAI-compatible client. `lib/ai/config.ts` explicitly states that the endpoint may later become a policy router / vLLM / distributed-inference surface with no application rewrite and no silent external fallback. The current chat route calls `williamosInference(CHAT_MODEL)` through this seam.

Issue #638 is the architectural predecessor that removed the active Vercel AI Gateway/external OpenAI defaults and established the local-first generic endpoint contract.

## Critical distinction

The current durable Thread is already conversation authority, but it is **not yet the complete Context Fabric**.

Context Fabric still needs to compile a bounded execution context from more than chat history:

- Project identity/resources;
- Thread messages;
- exact root/member work bindings;
- active Outcome/Work Order state;
- decisions/authority metadata;
- artifacts/evidence/governance/audit;
- selected memory/RAG/retrieval results;
- current execution/checkpoint state where appropriate;
- explicit exclusions, staleness, compression and provenance.

Therefore IF-04 should add a compiler/projection over canonical sources, not replace the sources.

## ContextPackage architecture

Preferred flow:

```text
canonical Project/Thread/work/evidence stores
        |
        +-- source selection / ownership / authority gates
        +-- retrieval/memory adapters
        +-- explicit exclusions / staleness
        v
versioned ContextPackage + digest + sourceRefs
        |
        +-- model/runtime formatter
        v
application inference seam / worker runtime
```

Provider-native session/KV/prefix/semantic caches remain derived optimizations. Losing them may cost time but may not erase canonical work continuity.

## Application inference routing consequence

Do not make every frontend route directly understand ModelArtifact/Runtime/ComputeResource/FreeToken/cloud provider details.

Prefer to keep the existing OpenAI-compatible application contract stable while changing what sits behind `WILLIAMOS_AI_BASE_URL` or an equivalent governed adapter. The Intelligence Fabric router may be introduced behind that seam or through a narrow server-side adapter that returns the same application contract.

A model switch, runtime switch, HERMES->OMEN opportunistic placement, or approved remote burst must not require rewriting `thread-chat` UI semantics.

## Required improvements to current Thread path

Current-main evidence also exposes limits IF-04 should address without confusing them with a rewrite:

1. Chat history currently compiles essentially the last bounded persisted messages plus a static system prompt; richer Project/work/evidence context is not yet injected through a canonical ContextPackage.
2. Provider/model identity is still configured globally (`CHAT_MODEL`) for the application chat path rather than selected per governed `InferenceRequirement`.
3. Assistant-reply persistence in the streaming `onFinish` path is best-effort; Context Fabric/Thread continuity acceptance must decide how an interrupted response is represented without fabricating a completed canonical message.
4. Context compression/summarization provenance is not yet represented as a first-class execution artifact.
5. The existing Workbench Thread projection and newer Environment/current-work projections must be reconciled so Context Fabric consumes the current owner rather than binding to a superseded UI projection.

These are extension seams, not permission to create another conversation database.

## Required reconciliation

Before IF-04 implementation, classify:

- `workbenchThread` identity/store;
- `workbenchThreadMessage` conversation store;
- `workbenchThreadSource` root/member bindings;
- Workbench Thread projection;
- Environment/current-work projection;
- Project/resource sources;
- Outcome/Goal/Work Order/Decision/Evidence/Governance/Audit sources;
- any memory/RAG/vector retrieval stores;
- Hermes kernel per-thread/session state;
- provider-native session state;
- `lib/ai/provider.ts` generic inference client;
- `lib/ai/config.ts` global model/base URL configuration;
- any newer current-main inference router or supersession.

Use: `REUSE_AS_IS`, `EXTEND_EXISTING`, `ADAPT_AT_BOUNDARY`, `DERIVED_CACHE_ONLY`, `SUPERSEDED_BY_CURRENT_MAIN`, or `GENUINELY_MISSING`.

## Acceptance

`CONTEXT_AND_INFERENCE_SEAMS_RECONCILED: PASS` requires:

- one canonical durable Thread identity remains authoritative;
- no duplicate general conversation/message database;
- ContextPackage is a projection/compiler with source provenance, not a new task authority;
- loss of provider session/cache cannot lose canonical Thread/work state;
- existing generic OpenAI-compatible application seam is reused/adapted unless current main proves a successor;
- model/runtime/compute placement can change without requiring frontend/provider-specific conversation forks;
- assistant partial/failure persistence semantics are explicit and truthful;
- current Environment ownership is reconciled before binding UI-specific sources.

Failure to reconcile blocks IF-04 with `FAILED_EXISTING_CONTEXT_SUBSYSTEM_NOT_RECONCILED`.
