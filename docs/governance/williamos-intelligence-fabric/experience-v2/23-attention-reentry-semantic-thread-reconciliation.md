# 23 — Attention, Re-entry, and Semantic Thread Reconciliation

## Finding

The existing Workbench UX contract already contains valuable invariants that Experience V2 should extend rather than replace:

- persistent Project/Thread/Inspector/panel state;
- no background focus theft;
- human `Needs you` semantics;
- durable Thread conversation;
- Activity-to-Thread focus;
- universal intent;
- ambient evidence-backed system truth.

Current Thread conversation storage is intentionally chronological owner/WilliamOS messages. Experience V2 requires a semantic projection over that durable truth, not replacement of it.

## Required distinction

Keep separate:

1. **Conversation chronology** — durable ordered messages.
2. **Work/event chronology** — execution, decisions, evidence, artifacts, changes.
3. **Semantic Thread projection** — derived current map of questions, hypotheses, decisions, settled truths, superseded branches, artifacts, open loops and active work.
4. **Re-entry projection** — derived `where you were / what changed / needs you / alive now` view.
5. **Attention projection** — derived ranking of events by owner-attention class.

The semantic/re-entry/attention projections may be rebuilt. They do not become a new authority source.

## Attention policy

Reuse the existing no-focus and genuine-owner-decision doctrine. Add explicit attention classification at projection/policy boundaries rather than creating a parallel notification product.

A background event may update Activity, Thread, ambient HUD/status or a deferred notice without opening UI or stealing focus.

`OWNER_DECISION` must bind to an actual unresolved authority boundary, not merely an agent wanting input.

## Re-entry

Persist location and selection separately from governed content. On re-entry, fetch canonical backend state and compute changes since the last trusted observation.

Do not store a generated summary as the sole record of what changed. Summary claims must remain traceable to canonical messages/events/evidence.

## Semantic map

A semantic map node should reference canonical source IDs and carry derived-state metadata. Candidate node kinds include:

- question;
- hypothesis;
- observation;
- decision;
- settled/proven truth;
- superseded/rejected branch;
- artifact;
- open loop;
- active work;
- waiting condition.

The map must never promote a model-generated interpretation into `DECIDED/SETTLED/PROVEN` without the underlying canonical authority/evidence transition.

## Cognitive contracts

`EXECUTE / EXPLORE / THINK_WITH_ME / DECIDE / REVIEW` should initially be treated as interaction/context policy, not five new workflow engines or five new task schemas.

Where an existing canonical object already represents the transition (Decision, Work Order, Thread, memory canon, etc.), reference it.

## Accessibility consequence

Re-entry and semantic projections should reduce transcript archaeology and working-memory reconstruction. Prefer concise structured hierarchy with drill-down to source chronology.

## Acceptance

- Destroy/rebuild all semantic summaries/maps: canonical Thread/work truth remains intact.
- A long Thread can be re-entered without rereading the transcript.
- Every settled/decided/proven semantic claim resolves to canonical evidence/authority.
- Background completion cannot steal focus.
- A generated summary cannot create an owner decision.
- Re-entry accurately distinguishes `changed while away` from older history.
- Existing Workbench continuity/no-focus foundations are reused, not duplicated.
