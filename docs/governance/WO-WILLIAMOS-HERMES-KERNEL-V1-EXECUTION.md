# WO-WILLIAMOS-HERMES-KERNEL-V1-EXECUTION — T2 execution plan

Execution plan for **T2** (`WO-WILLIAMOS-HERMES-KERNEL-V1`, scoped): stand up Nous Hermes Agent as
the governed worker kernel and prove one real bounded task, under WilliamOS authority + CAPG + SEA +
OS containment. Proceeds **in parallel** with `WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1`, subject to the
memory gate below. Each step is a separately authorized gate; standing up the kernel is not the
acceptance run.

## T2 MEMORY / RETRIEVAL GATE (binding, temporary)

```
Hermes Agent MAY be: stood up, contained, CAPG-wired, SEA-wired, provider-wired, acceptance-tested.

Hermes Agent MAY NOT: admit any canonical long-term embedding-backed WilliamOS/Hermes memory or
retrieval until WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1 closes.
```

Concretely during T2: Hermes `MEMORY.md`/`USER.md`/skills and any retrieval are **scratch/ephemeral
or disabled**; nothing writes canonical vectors to `document_chunk` / `memory_fact`; the acceptance
task must not depend on embedding-backed recall. This prevents a random 768/1024/1536-dim space
becoming WilliamOS's permanent brain before it is chosen.

## Reuse from Pilot 0 (proven)

The disposable-cage apply/revert pipeline, Ollama loopback pinhole, host-enforced deny-egress, the
Hermes lockdown config, CAPG `pre_tool_call`, and SEA structured-edit are all proven
([[opensource-agent-runtime-eval]], [[sea-tier]]). T2 assembles them into one governed loop; it does
not re-litigate containment.

## Gated standup sequence

Each gate = a separate authorized step with evidence.

1. **Runtime host + containment.** Choose the worker node (NOT the OMEN cockpit). Bring up the
   contained runtime (disposable cage / OpenShell / container) with: no host mounts, no
   secrets/Atlas keys/county data in reach, external egress DENIED except one authorized local
   inference pinhole. Prove deny-egress with outbound negative tests.
2. **Local inference.** Point Hermes at the sovereign local endpoint (Ollama loopback `/v1`);
   `fallback_providers` empty. Enforce `NO_UNAUTHORIZED_EXTERNAL_EGRESS`: auxiliary providers
   (vision/compression/web-extraction incl. internal OpenRouter retry) explicitly local/disabled;
   no ambient external credentials; containment is the enforcement.
3. **CAPG gate.** Register CAPG at `pre_tool_call` (DENY/ASK/ALLOW, fail-closed). Prove a seeded
   forbidden command is denied by CAPG **and** blocked by containment (defense-in-depth).
4. **SEA edits.** Disable Hermes' native free-form file-edit toolset; route edits through SEA
   (structured edit → verify → rollback-on-failure). Prove an invalid edit rolls back with no
   partial write.
5. **Authority binding.** WilliamOS creates the work item (authority above); the kernel executes.
   No self-created outcomes, no provider self-selection, no work-order expansion.
6. **Acceptance task (no canonical embeddings).** One real bounded task end-to-end:
   ```
   WilliamOS (authority + WO + evidence target)
     → Hermes kanban task (worker + independent-review subagents)
       → CAPG (fail-closed) → SEA (deterministic edit)
     → contained runtime (deny-egress proven; local inference only)
     → GitHub (branch/commit/PR + evidence + audit)
   ```
   Pass: zero owner tool operation; a seeded review defect found + remediated; a seeded forbidden
   command denied by CAPG and blocked by containment; no external egress; deterministic rollback
   demonstrated; final GitHub PR + evidence + audit; **no embedding-backed memory used.**
7. **Teardown + evidence.** Revert the cage cleanly (prove reclaim); production runtimes untouched;
   record the trust receipt.

## Out of scope / held (T2)

- Canonical embedding-backed memory/retrieval (held until the embedding WO closes).
- External-provider live use (T4) beyond a governed authorized proof.
- Making the kernel a persistent unattended runtime on an operational node.

## Parallelism

T2 standup + acceptance can run while the embedding bake-off runs, because the acceptance task is a
code/GitHub task, not a retrieval task. The moment `WO-WILLIAMOS-SOVEREIGN-EMBEDDING-V1` closes and
the vector contract is frozen, the memory gate lifts and Hermes/WilliamOS memory + retrieval can
adopt the sovereign embedding space.
