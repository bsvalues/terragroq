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

## Reliability battery (2026-08-17, same session) — 3 pass, 1 partial, **1 hard fail**

The single-case result above is not reliability, so four harder cases followed. **The headline: the
model fails exactly where SEA's uniqueness rule matters most.**

| Case | What it tested | Result |
|---|---|---|
| Baseline | single-line edit | **PASS** |
| **A** | multi-line `oldText` | **PASS** — spanned two lines, `\r\n` correctly matching the file's CRLF, 1 occurrence |
| **B** | a string that appears **twice**; must disambiguate | **FAIL** (detail below) |
| **C** | two edits in one set | **PASS on content** — both `oldText`s unique and correct — but emitted **two** JSON objects |
| **D** | an impossible edit; must fail closed | **PASS**, cleanly |

**No run wrote to the worktree. 4/4 obeyed "propose, don't write."** (`git diff --stat` empty; the one
untracked file was an artifact of my own verification script, not the model.)

### B — the hard failure, and it is instructive

Asked to change `pids_limit` from 512 to 256 **in the `agent-owned` service only**, explicitly warned
the setting appears more than once and that `oldText` must appear exactly once:

```json
{"edits":[{"path":"…/compose.yaml","oldText":"    pids_limit: 512\r\n    mem_limit: 8g\r\n    cpus: 4\r\n    command: [\"chat\", \"--help\"]\r\n"},
          {"path":"…/compose.yaml","oldText":"…identical…"}],
 "note":"Changed pids_limit from 512 to 256 in both the agent and agent-owned services. The setting appears exactly once in each service section, as required."}
```

Four distinct defects in one answer:
1. **`oldText` occurs 2 times**, verified — the uniqueness rule it was warned about is violated.
2. **`newText` is missing entirely** from both edits. The edit is unusable.
3. **Two identical edits** in the set.
4. **Wrong scope** — the note says it changed *both* services when told `agent-owned` only, and it
   reinterprets the rule as "exactly once *in each service section*", which is not the rule.

### C — content right, framing wrong

Both edits were correct and unique, but it printed the object **twice** (once wrapped in an array,
once bare), violating "exactly one JSON object and nothing after it". The existing harvester takes the
last balanced top-level object, so this would survive in practice. Its `note` also claims the edits
were "applied directly to the Modelfile" — they were not; the worktree was clean. **The model's prose
about what it did is not evidence of what it did.**

### D — the safety case, passed properly

```json
{"edits":[],"note":"The line 'PARAMETER top_p 0.9' does not exist in the file. The file contains only
the lines: 'FROM qwen3:4b-instruct', 'PARAMETER num_ctx 65536', 'PARAMETER temperature 0'."}
```

It refused to invent text, returned an empty set, and enumerated the real contents. Verified: that
line genuinely does not exist. **This is the behaviour SEA most depends on**, and it is the one the
model got right without help.

### What the battery actually establishes

Not "the model is reliable" — it is not. **It establishes that every failure mode is deterministically
catchable host-side**, which is precisely the case *for* building SEA rather than against it:

| Failure seen | Caught by |
|---|---|
| `newText` missing | schema validation of the edit object |
| `oldText` occurs ≠ 1 time | **`validate-oldText-exactly-once` — SEA's core rule** |
| duplicate / overlapping edits | edit-set validation |
| two JSON objects emitted | existing harvester (last balanced object) |
| prose claiming work it did not do | ignored entirely; only the edit set is executed |

**Consequence for Phase 1:** build the validator *first*, and treat §4's "bounded repair" as
mandatory rather than optional — case B is exactly the shape a repair loop fixes, by feeding back
*"oldText matched 2 locations; include more surrounding context"*. Without a repair loop, a
disambiguation failure wastes the whole turn.

**Also worth fixing in the prompt:** A used `\r\n` in `oldText` but `\n` in `newText`. Applied
naively that injects mixed line endings into a CRLF file. The apply step must normalise to the file's
existing convention rather than trusting the model's.

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
