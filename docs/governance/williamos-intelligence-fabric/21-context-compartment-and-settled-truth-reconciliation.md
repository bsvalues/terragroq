# 21 — Context Compartment + Settled Truth Reconciliation

## Purpose

Prevent Experience V2 / Context Fabric from creating a second memory system while adding the missing world/context isolation needed for a deeply personalized WilliamOS.

## Current-main predecessor truth

Current `memoryFact` already provides a strong authority lifecycle:

`unreviewed -> working/reviewed -> canon -> deprecated/superseded/archived`

and authority-aware semantic recall already excludes deprecated, superseded and archived facts.

Current Decisions/Doctrine also carry scope, lifecycle, evidence and supersession fields. Current Projects/Threads are durable context owners rather than repository aliases.

This is valuable substrate and must be extended, not duplicated.

## Gap

Memory/corpus recall is currently primarily user-global. `memoryFact` has user identity, tags and authority but no first-class governed world/context compartment. Document/corpus vector search similarly filters by user, not by explicit world/data-policy compartment.

That is insufficient for Experience V2, where personal/private, family, professional/public, founder/commercial and system contexts must remain meaningfully separated even when semantic similarity is high.

## Required architecture

Prefer:

`existing canonical registers + compartment metadata/policy -> ContextPackage compiler -> selected model/worker`

Do not create another general memory database.

At minimum distinguish:

- canonical truth source;
- epistemic/authority status;
- owning world/context;
- permitted recipient classes;
- permitted execution locality/trust class;
- sensitivity/egress policy;
- explicit cross-world sharing/derivation;
- provenance and supersession.

## Settled Truth

Experience V2 `QUESTION / HYPOTHESIS / OBSERVED / LIKELY / DECIDED / SETTLED / PROVEN / SUPERSEDED / DISPROVEN` must reconcile onto existing memory/decision/doctrine authority rather than creating contradictory parallel states.

A retrieval result may not override a stronger settled/proven source merely because its vector similarity is higher.

Agents may challenge settled truth only by attaching explicit counterevidence and opening a governed review/supersession path.

## ContextPackage compilation

Each model/worker execution should receive an explicit compiled package containing only data permitted for that execution. The compiler should reason over:

- current world;
- Project/Thread;
- selected object;
- requested cognitive contract;
- authority/work scope;
- recipient worker/provider/model/runtime;
- locality/trust class;
- sensitivity/egress rules;
- settled truth required for the task;
- relevant working/exploratory context.

Provider/model native session state is an optimization and may not widen the package.

## Cross-world rule

Semantic relevance alone is never sufficient authority to cross a world/context boundary.

Examples:

- private relationship reflection must not appear in a TerraFusion coding context;
- county/public data must not enter founder/commercial or external-provider context without explicit policy;
- technical preferences may be shareable across system/project worlds when their policy allows it;
- a user can explicitly promote/share a fact into a broader permitted scope with provenance.

## Derived summaries

A summary created from restricted source material inherits at least the strictest applicable source restriction unless an explicit reviewed redaction/declassification process proves otherwise.

Embeddings are treated as derived data, not automatically public metadata.

## Acceptance

PASS requires:

1. current memory/decision/doctrine/project/thread owners are mapped;
2. no second universal memory source is introduced;
3. world/context compartment is first-class and enforceable before retrieval/context injection;
4. semantic search cannot cross a forbidden boundary;
5. settled/proven truth outranks unsupported semantic recall;
6. supersession preserves lineage;
7. provider/model session state cannot bypass ContextPackage policy;
8. derived summaries/embeddings retain appropriate source restrictions;
9. personal/private -> professional/repository/model leakage tests fail closed;
10. existing unscoped records receive an explicit migration/default policy rather than silently becoming universally shareable.

Failure code: `FAILED_CONTEXT_COMPARTMENT_PREDECESSORS_NOT_RECONCILED`.