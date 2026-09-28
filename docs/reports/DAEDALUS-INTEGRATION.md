# Daedalus model-fabric integration

Updated September 9, 2026. Owner request: integrate DAEDALUS into WilliamOS/HERMES so bounded model work and its evidence move between machines without the owner carrying prompts or result files.

## Verified operational scope

**HERMES can now place and execute a read-only Work Order on DAEDALUS's RTX 3090, then receive the model result and evidence automatically.** Two real Qwen3-8B jobs completed through the headless CLI. The second required a fresh, eligible model-fabric placement recommendation. Replaying the first returned its existing receipt and turn rather than running inference again.

The implemented lane is on-demand local inference, using the pinned `Qwen/Qwen3-8B` revision `b968826d9c46dd6066d109eabc6255188de91218`, Hugging Face BF16, and no quantization. Each invocation loads the model in a bounded subprocess; this is not a continuously loaded inference server. There are no model tool calls, code edits, shell tools, commits, hosted-model fallback, or autonomous work selection. The policy remains `PILOT_AUTHORIZED`, with one concurrent turn and a 300-second deadline.

HERMES supplies immutable tracked repository context and owns dispatch/result handling. DAEDALUS executes on its GPU. ATLAS's durable-state role and the existing nodes' authority remain unchanged. General repository-editing worker capacity is declared in the node contract but was not commissioned by these read-only jobs.

## Live acceptance evidence

| Acceptance | Verified result |
| --- | --- |
| Incoming execution channel | `ssh daedalus` from HERMES reaches `daedalus@192.168.88.6:2222` with strict host-key checking and the existing fabric key. |
| Machine identity | Seed pins machine-ID SHA-256 `cc4b1b2b7b646030b222edd2e24ef3711c3621af06b21555355fef718889effb`; live probe matches. |
| GPU | RTX 3090, 25,769,803,776 bytes VRAM; UUID `GPU-0264b108-cdec-22ee-0bc6-6d44280efe45`. |
| Job 001 | `WO-DAEDALUS-COMMISSION-001` completed at `2026-09-09T23:08:53.338Z`; turn `fb8f5523-eec0-4cb1-a197-fd97a814446c`. This established initial accepted execution before the normal placement gate was added. |
| Replay | Repeating job 001 returned `replayed:true` with the same completed turn. No second inference was dispatched. |
| Fresh placement | Canonical live Linux probe, worker health, pinned production registry assembly and the real recommender selected `daedalus` for `qwen3-8b-resident-inference`. Compute was READY; evidence TTL is 300 seconds. |
| Job 002 | `WO-DAEDALUS-COMMISSION-002` completed at `2026-09-09T23:15:20.487Z`; turn `ccb9542d-0f59-454e-a2cb-3af45c001810`. Its dispatch record has `commissioning:false` and embeds the eligible placement decision. |
| Return path | Both jobs automatically returned schema-validated output, kernel evidence, inference request/result and telemetry to HERMES. Job 002 reports no telemetry errors or resource stop reasons. |

Controller evidence root: `C:\HermesLab\daedalus\evidence`.

- `work-orders/<id>/receipt.json`: completed dispatch identity, model result, output hash and evidence location.
- `work-orders/<id>/dispatch.json`: thread/workspace, policy Work Order, immutable context hashes and, for normal jobs, the placement decision.
- `work-orders/<id>/result.json`: substantive model output and its evidence path. `READY_FOR_VALIDATION` means returned analysis awaiting HERMES review; it does not claim tests or software changes.
- `daedalus/<threadId>/<turnId>/`: `packet.json`, `session.json`, `stdout.txt`, `inference-request.json`, `inference-result.json`, and `inference-stderr.txt`. The remote client verifies returned file hashes and thread/turn/model bindings.
- `placement/`: the latest `daedalus.json` probe, `health.json`, assembled `snapshot.json`, and `recommendation.json`.

Job 001 result SHA-256: `518170dbde7a8b8ad2eeceaeecef2ccc04e1396b8ffc04b95be95d0cf0d01730`.
Job 002 result SHA-256: `b6ba372bc236d6b44efb9f13c2446561235877228f4daa8ec97758a20fac3738`.

See [SSH bootstrap and restart evidence](daedalus-access/README.md) for the pinned host fingerprint, SCP roundtrip, user service and source-restricted key. Service restart recovery was tested; **machine reboot recovery was not tested**.

## Operator commands

Run from the current HERMES deployment checkout, `C:\HermesLab\daedalus-integration`. The controller configuration is `C:\Users\bs\.williamos\fabric\daedalus-model.json`. It selects `remote-resident-model` explicitly; these commands do not require Codex Desktop on DAEDALUS.

```powershell
node scripts/hermes-bridge/model-fabric-cli.mjs health --config C:/Users/bs/.williamos/fabric/daedalus-model.json
node scripts/hermes-bridge/model-fabric-cli.mjs place --config C:/Users/bs/.williamos/fabric/daedalus-model.json
node scripts/hermes-bridge/model-fabric-cli.mjs dispatch --config C:/Users/bs/.williamos/fabric/daedalus-model.json --work-order C:/HermesLab/daedalus/work-order-002.json
```

The last command replays the existing job. To perform new authorized work, create a Work Order JSON with a new ID and branch, an objective, the exact 40-character base commit already available in the remote repository, and explicit tracked context paths:

```json
{
  "id": "WO-DAEDALUS-READ-003",
  "objective": "Summarize the supplied source and distinguish observed facts from uncertainty. Do not claim actions or tests.",
  "branch": "codex/daedalus-read-003",
  "baseSha": "28b4225ef0e1dce45dbe3d65be4ef4bdc64698f8",
  "contextPaths": ["config/execution-fabric/node-identity-contract.json"]
}
```

That base is the commissioning source snapshot, not a promise that it is the latest source. Select the intended available commit for subsequent work. Context is read as Git blobs at the named commit, not arbitrary working-tree files. The CLI bounds context and caps the assembled prompt at 16,000 characters. Normal dispatch refreshes placement itself and requires the configured node to be eligible and its read-only health to remain ready.

`commissioning:true` is an explicit initial/requalification pilot option. It bypasses only the normal placement eligibility requirement; it does not bypass machine transport trust, read-only policy, invoker qualification, kernel workspace, quarantine, or output gates. Do not use it for routine jobs to conceal unhealthy placement.

A durable exclusive claim prevents duplicate dispatch. Identical completed requests replay; changing an existing ID's objective/configuration conflicts. A running, failed or ambiguous claim returns `RECONCILIATION_REQUIRED` on another attempt. Inspect its `dispatch.json` and remote thread evidence to establish what happened. Do not delete claims, relabel the same uncertain job with another ID, or assume transport timeout means remote cancellation. There is no automatic recovery/retry scheduler.

## Health and placement

`health` reports current reachability, policy mode, GPU identity and the latest accepted execution evidence. READY requires a matching accepted kernel turn within 24 hours, unchanged policy/worker/invoker hashes, current GPU presence, required model files and no quarantine. Full model-file hashes are checked again at each invocation. This is on-demand worker readiness, not proof that a model remains loaded in GPU memory.

`place` obtains a fresh canonical Linux inventory, checks its machine identity against the seed, correlates its GPU with health, and advertises the model only when these observations agree. Stale, mismatched or unready evidence cannot produce a healthy model roster. The recommender itself remains recommendation-only; explicit Work Order dispatch is the separate authorized action.

The HERMES scheduled task `WilliamOS-Daedalus-Health` runs `place` every minute. It is registered as user `bs` with **Interactive logon**, so `bs` must remain logged in. Its observed run at 16:15:15 Pacific returned task result `0`. This task refreshes inventory/placement only; it does not dispatch models. Background execution while logged out is not established.

## Deployment and recovery runbook

The operational controller currently executes directly from `C:\HermesLab\daedalus-integration`. The remote source snapshot is `/home/daedalus/.local/share/williamos-daedalus/repository`; runtime state is the sibling `runtime` directory, and the policy is `config/model-policy.json`. The configured Python launcher is `/home/daedalus/.venvs/daedalus-gpu/bin/python`; remote Node is `/home/daedalus/.hermes/node/bin/node`. Keep the controller configuration and policy local; neither requires moving private credentials into this repository.

When deploying a source change:

1. Preserve active Work Order claims/evidence and avoid replacing the invoker during a turn. Record the source commit or exact snapshot/file hashes being deployed.
2. Deploy the compatible bridge/kernel/invoker source and canonical probe/identity contract to the remote repository. Retain Linux LF endings for shell/Python scripts. Deploy the matching controller source, registry seed, identity contract, workload catalog and assembler pins together. Do not copy HERMES's Windows-specific model policy over the Daedalus policy.
3. Keep policy pins tied to the actual qualified worker, model files, revision and GPU. A policy, worker or invoker change invalidates the previous accepted health record. Do not update an acceptance receipt's hashes to make the new deployment appear qualified.
4. Check `health`; then run a new explicitly bounded commissioning Work Order if qualification was invalidated. Inspect its actual returned evidence and run `place` before normal dispatch resumes.
5. If relocating the controller checkout, update the scheduled task's executable arguments and working directory as well as the configuration. Verify a task run and fresh placement; the present task still depends on this integration checkout.

To withdraw this lane, disable `WilliamOS-Daedalus-Health` and stop issuing new Work Orders while retaining receipts and remote thread evidence. Reconcile any active turn before restoring a prior source/policy snapshot. A restored deployment must pass health/placement again; do not clear quarantine without resolving its recorded cause. Other HERMES backends and node services do not need to be redirected.

## Remaining integration and repository admission

This verifies the complete **explicit, headless read-only inference route**: HERMES placement -> DAEDALUS GPU execution -> validated result/evidence on HERMES. `nextAction: RETURN_TO_HERMES` is machine-readable continuation data. It does not prove that the existing HERMES daemon automatically consumes the receipt and dispatches a successor.

The existing AEGIS-pinned daemon route and legacy shadow admission allowlists remain unchanged. Autonomous queue pickup, daemon successor scheduling, repository editing/publication, logged-out controller operation and machine reboot recovery are not commissioned by this acceptance. The model remains an on-demand worker, and the health task requires the interactive HERMES session.

Targeted automated verification: 325 tests passed across nine source suites, including CLI/refresh contention tests; eight Linux invoker tests passed separately. Coverage includes exclusive claims, completed replay, ambiguous failure, corrupt evidence, stale/mismatched identity and GPU observations, normal placement versus explicit commissioning, and the kernel/protocol controls. Fixture tests do not substitute for the two live jobs above, and live success does not substitute for all CI checks.

[PR #1185](https://github.com/bsvalues/terragroq/pull/1185) remains a separate repository admission process. The previously observed delivery-seal failure requires a genuine WilliamOS Space-assignment seal; no client-authored receipt or bypass is valid. The access lane is pursuing that admission path. This report does not claim that the PR is admitted, merged, or deployed from merged main merely because the local live route works.

## Final acceptance update

After the nonblocking stdin timeout fix, job 003 requalified the deployed invoker at 2026-09-09T23:18:59.469Z. Job 005 then completed through normal refreshed placement at 2026-09-09T23:21:15.620Z, with thread 0251047b-2462-45ab-bf6c-2813801a7376 and turn 7ac845a6-5dbc-42eb-804b-7cc2296f5225. Its controller result SHA-256 is a76cf26c19e5d055819834193045b19472edf3448976776ec26c375a2071ebf6. The receipt is under evidence/work-orders/WO-DAEDALUS-COMMISSION-005 in the controller evidence root above.

Job 004 stopped before remote dispatch when it encountered the minute health refresh lock. Its original claim/failure and separate reconciliation review are retained. The CLI now waits at most ten seconds for this preflight lock only; it never retries an inference. GPU health also rejects failed or timed-out probes and requires the previously accepted GPU identity to match.

The source change is being delivered on codex/daedalus-model-fabric because the existing WilliamOS admission path requires that branch prefix. Its authentic prospective admission is Space 0773833f-8e29-4e23-a294-4bc9a8f90bb7, Work Order 121, GRANT-0097. Original PR 1185 remains source provenance; admission does not retroactively claim earlier execution occurred under that grant.
