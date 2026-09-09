# Daedalus model-fabric integration

Owner request, September 9, 2026: integrate DAEDALUS as a WilliamOS/HERMES model-fabric node so model work and results move through the control plane without the owner acting as courier.

## Current status

**Implementation in progress; live commissioning blocked.** Do not interpret source registration, a Codex Desktop installation, or a client certificate as a functioning execution worker.

- Daedalus's earlier local network output identifies `192.168.88.6`, interface `enp1s0`, MAC `04-7B-CB-A5-34-65`; Hermes's current neighbor entry matches. The address is a location, not a machine identity pin.
- Direct SSH from Hermes to that address refuses the connection before authentication. No verified SSH host key is installed for Daedalus.
- The existing remote Codex task is readable but its execution provider reports a usage-limit failure. No credit purchase/reset was attempted.
- The signed Hermes client certificate was delivered and verified. This provides client access, not incoming shell execution.
- Recovered qualification records identify `Qwen/Qwen3-8B`, revision `b968826d9c46dd6066d109eabc6255188de91218`, using `/home/daedalus/.venvs/daedalus-gpu/bin/python`. The model directory is `/home/daedalus/Documents/Codex/2026-09-09/you/outputs/bakeoff005/Qwen3-8B/model`; qualification artifacts are under `outputs/worker-qualification-v4/`. These are historical task records, not current machine observations. The worker was a local Python subprocess, not a resident inference service.

## Placement and ownership

The reviewed node identity contract and registry seed declare Daedalus as a resident GPU model/repository worker. Its machine identity, inventory, model roster and compute health remain unknown until observed. HERMES coordinates; ATLAS retains durable state; DAEDALUS executes bounded jobs in owned scratch/worktrees. No production-data, durable-state or autonomous work-selection authority is added.

The `qwen3-8b-resident-inference` workload requires fresh observed evidence, READY compute, 24 GiB GPU memory, and a healthy `remote-resident-model` runtime reporting `Qwen/Qwen3-8B`. The existing recommender remains recommendation-only. A recommendation does not authorize dispatch, prove BF16 qualification or turn on the scheduler.

## Remaining live acceptance

1. Run scoped SSH enrollment from a working Daedalus-side execution channel; independently obtain and pin its SSH host key and machine identity before adding its live fabric broker entry.
2. Read the actual worker and qualification artifacts. Adapt the qualified Linux worker to the supported bounded model invocation contract; do not substitute the Windows HERMES policy or call a hosted Codex model.
3. Dispatch a bounded work order from HERMES, verify the actual model/revision and GPU, and automatically return its output/evidence with matching hashes. Exercise failure, timeout and retry without duplicate work.
4. Connect fresh worker health/model observations to placement, prove stale/offline exclusion, and then activate the explicit worker configuration. Do not promote a configuration-only roster to READY.

No existing HERMES inference service, other-node broker entry, or scheduler activation was changed by the source integration.

## Source execution seam and configuration

`RemoteResidentModelExecutionBackend` in `scripts/hermes-bridge/execution-backend.mjs` reuses the existing SSH workspace/git/validation mechanics. Its client calls `remote-resident-model-worker.mjs` on the configured repository checkout. That helper executes the existing `createHermesKernelClient` on the worker, preserving its qualification, owned-worktree, quarantine, timeout and output-schema checks. The transport invokes Node over SSH, never Codex. Requests travel over stdin, and the transport requires an already trusted SSH host key.

The controller must explicitly supply every value below. Paths are configuration placeholders, not claims that files exist on Daedalus:

```text
WILLIAMOS_EXECUTOR=remote-resident-model
WILLIAMOS_MODEL_EXEC_NODE=<verified SSH destination>
WILLIAMOS_MODEL_NODE_ID=daedalus
WILLIAMOS_MODEL_ID=Qwen/Qwen3-8B
WILLIAMOS_MODEL_RUNTIME_ROOT=<absolute Linux runtime directory>
WILLIAMOS_MODEL_REPOSITORY_ROOT=<absolute Linux checkout containing this implementation>
WILLIAMOS_MODEL_POLICY_PATH=<absolute qualified Daedalus policy path>
WILLIAMOS_MODEL_INVOKER_PATH=<absolute Linux-compatible bounded invoker path>
WILLIAMOS_MODEL_EVIDENCE_ROOT=<absolute controller evidence directory>
```

The remote policy must bind `placement.executionNode` to `daedalus` and `model.id` to the configured model. Changing these fields on the existing HERMES policy does not qualify the Daedalus runtime. The current repository invoker has Windows-specific deployment paths; a compatible, qualified Linux invoker has **not** been deployed or demonstrated. The historical Python benchmark worker is not assumed to implement this kernel contract.

After that live preparation, the explicit programmatic route is:

```javascript
import { selectExecutionBackend } from "./scripts/hermes-bridge/execution-backend.mjs"
const backend = selectExecutionBackend(process.env)
const observation = await backend.health()
// The base SHA must already exist in the remote checkout.
const { workspacePath } = await backend.prepareWorkspace({ branch, baseSha })
const client = await backend.runCodexClient({ workspacePath })
try {
  await client.connect()
  const threadId = await client.startThread()
  const result = await client.runTurn({ threadId, prompt: boundedWorkOrderPrompt })
  // result.finalText is schema-validated; result.evidencePath is on this controller.
} finally { client.close() }
```

For every completed turn, the controller automatically stores `packet.json`, `stdout.txt` and `session.json`, verifying the packet/stdout digests and their thread/turn/model bindings. Edited repository files remain in the remote owned worktree, accessible through the backend's git and command methods; no implicit patch application to the controller occurs. The helper is a tool of the trusted SSH account, not a public network service or a new authority boundary. A transport timeout does not establish cancellation of an already running remote job; use its persisted thread evidence to reconcile before retrying. Automatic idempotent retry has not been proven.

`health()` currently reports SSH reachability, invoker presence, quarantine and the **configured** model roster. It deliberately reports `runtimeState: UNKNOWN` and `ready: false`; it neither probes the inference runtime nor ingests observations into placement. A successful fixture test is not a live health observation.

The existing resident CLI route with `requireAegis` still pins AEGIS. It has not been relaxed or redirected. The generic backend selection and direct client route above are implemented; full scheduled Work Order dispatch, repository validation/publication and handoff through the running HERMES daemon are **not commissioned or verified** for Daedalus. This is source integration only, not completion of the owner's end-to-end request.

Targeted verification: 47 tests pass across the new remote protocol suite and the existing execution-backend/kernel suites. The remote tests exercise the real kernel client with a fixture invoker, including automatic evidence return, corruption rejection, node/model mismatch, unproven qualification and quarantine. They do not execute Linux/Qwen. The checkout's default Vitest configuration could not load `@vitejs/plugin-react`; these non-UI suites were run with a temporary Node-only configuration.

## Verification and admission boundary

The focused registry, placement, projection and execution/kernel suites passed (260 tests total across six suites); enrollment shell syntax also passed. The Node-only Vitest configuration supplies the repository alias and omits UI plugins because these suites do not render UI. No live Daedalus model execution is included in those results.

The legacy shadow placement/admission allowlists are unchanged and do not admit Daedalus. They must not be treated as the dispatch route for this integration. Machine identity enrollment, a compatible qualified Linux invoker, live health ingestion, safe retry/reconciliation and the running supervisor handoff remain open acceptance work.
