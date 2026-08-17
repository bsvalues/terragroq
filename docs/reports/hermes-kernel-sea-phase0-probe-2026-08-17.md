# SEA Phase 0 probe — can the resident model emit a structured edit? (2026-08-17)

**Verdict: PASS on every criterion, n=1.** `williamos-qwen3-4b:64k` produced a valid structured edit
whose `oldText` matched the file byte-for-byte and appeared exactly once, and it did **not** write to
the worktree when told not to.

**Gate for:** [`WO-WILLIAMOS-HERMES-KERNEL-SEA-001`](../governance/WO-WILLIAMOS-HERMES-KERNEL-SEA-001.md)
Phase 0, defined in
[the scope](../governance/WO-WILLIAMOS-HERMES-KERNEL-SEA-001-scope.md).
The premise under test: Pilot 0 proved this model class fails at *free-form* editing (literal diff
markers, raw tool-call JSON as text, hallucinated paths). SEA assumes it nonetheless succeeds at
*structured* editing. **That assumption had never been tested.**

## Setup

| Item | Value |
|---|---|
| Host | HERMES, Docker 28.5.1, image `williamos-hermes-agent:0.20.0-fa83af3` id `sha256:612bd343…` (matches the policy pin) |
| Checkout | `C:\HermesLab\terragroq-s2` @ `8165de7` (probe tests the MODEL, not today's walls) |
| Worktree | `<runtime root>\worktrees\phase0-sea-probe`, branch `phase0/sea-probe` |
| Driver | invoker called **directly**, not through `createHermesKernelClient` — see "why direct" below |
| Run id | `phase0-581fee48967a455b8f22d7a86243f2c7` |
| Kernel session | `20260817_221430_a8b343` |
| Duration | **1m 37s**, 6 messages, 4 tool calls, invoker exit 0 |

**Why direct rather than through the client:** `HERMES_TURN_OUTPUT_SCHEMA` sets
`additionalProperties: false`, so a turn carrying an `edits` array is rejected as `ADDITIONAL:edits`.
Phase 0 is a model-capability question, not a lane-plumbing one; going direct answers it without
pretending the schema already supports SEA. Extending that schema is Phase 1 work.

## The task

A deliberately small target — `runtime-hermes-agent/Modelfile.qwen3-4b-64k`, three lines — so the
probe tests **format fidelity** (byte-exact copying, clean JSON) rather than context length or
reasoning. The prompt forbade writing to disk and demanded exactly one JSON object of the shape
`{"edits":[{"path","oldText","newText"}]}`, with `oldText` copied verbatim and appearing exactly once,
no diff markers, no line numbers, no ellipses, no prose after the object.

## Result

```json
{"edits":[{"path":"runtime-hermes-agent/Modelfile.qwen3-4b-64k","oldText":"PARAMETER temperature 0","newText":"PARAMETER temperature 0.2"}]}
```

Machine-verified against the real file, not eyeballed:

| Check | Result |
|---|---|
| JSON found and parses | **true** |
| `path` resolves to a real file in the worktree | **true** |
| `oldText` occurs in the file | **exactly once** |
| `oldText` byte-for-byte verbatim | **true** |
| Applying it changes the file | **true**, result line `PARAMETER temperature 0.2` |
| Worktree modified by the model | **no** — `git status --porcelain` empty |
| Containers left behind | none |
| Quarantine marker | absent |

Both instructions the SEA contract depends on were followed: **propose, don't write**, and
**copy `oldText` exactly**.

## The interesting part: the failure mode appeared and self-corrected

The model's first tool call was `read Modelffile.qwen3-4b-64k` → *File not found*. It then retried
with the correct name and succeeded. That is precisely the hallucinated-path failure Pilot 0
recorded — and here it was **recoverable within the turn**, because the tool returned an error the
model could see and act on.

This is an argument *for* the SEA design rather than against it: host-side
`validate-oldText-exactly-once` catches the same class of error deterministically, before any write,
instead of relying on the model noticing.

## Honest limits of this result

- **n=1.** One model, one small file, one single-line edit, one attempt. The scope asked whether the
  model does this **reliably**; a single success is not reliability. Before committing to Phase 1,
  repeat with: multi-line `oldText`, a file where the target string appears more than once (the
  exactly-once rule should then force a longer, disambiguating `oldText`), more than one edit in a
  set, and a larger file.
- **No adversarial or failure cases probed.** What the model does when the edit is impossible, or
  when it cannot find the text, is unknown — and that path matters, because SEA must fail closed.
- **The checkout is at `8165de7`**, so this exercised the invoker as it stood before the C4/C6/C7
  walls landed. Irrelevant to the model-capability question; relevant if anyone reads this as a lane
  regression test, which it is not.

## Incidental finding — the lane was dead before this probe

`williamos-hermes-inference-proxy` had been **exited (255) for four hours**, after repeated
`INFERENCE_PROXY_UPSTREAM_WALL` 502s on `/v1/models`. Root cause: the `ollama` container was attached
only to `bridge`, **not** to `hermes_default`. The proxy resolves its upstream by hostname `ollama`
over `hermes_default`, so the name was unresolvable. Every other container on that network (redis,
postgres, portainer, open-webui) was attached; ollama came back without it after a restart.

Fixed with `docker network connect hermes_default ollama` — reversible, and it does not touch the
agent's internal network (`williamos_free_agent_internal`), so containment is unchanged. The proxy
then started clean and stayed healthy with no further 502s.

**Consequence worth noting: the resident lane would have failed at `connect()` for anyone who tried
to use it during those four hours.** Nothing monitors this.

## Cleanup — done, and recorded here rather than only in a commit message

Removed after the run and verified absent: the probe worktree and branch `phase0/sea-probe`,
`C:\HermesLab\phase0` (packet + captured output), and the thread state dir
`<runtime root>\hermes-kernel\threads\phase0`. Checkout `C:\HermesLab\terragroq-s2` clean, 0 agent
containers, no quarantine marker. **Left running deliberately:** the inference proxy, now healthy —
it is standing infrastructure, and leaving it dead would re-break the lane.

(Recording cleanup in the report is deliberate: the P2 report claimed a leftover probe policy that had
in fact been removed, which sent the P3 reviewer hunting a bypass that no longer existed.)
