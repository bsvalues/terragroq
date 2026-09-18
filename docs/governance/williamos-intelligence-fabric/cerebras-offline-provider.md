# Cerebras optional Tier 3 provider — runtime-wired candidate, key not installed

The existing `scripts/execution-fabric/external-model-api.mjs` Tier 3 adapter exposes
`callCerebrasModelApi`. Its production caller is the explicit one-shot
`scripts/execution-fabric/cerebras-smoke.mjs` CLI, not the generic qualification runner (which
requires provider-reported cost fields Cerebras does not supply). It is disabled unless
`WILLIAMOS_CEREBRAS_ENABLED=true` is explicit and `CEREBRAS_API_KEY` is present. Neither value
is installed by this change. The standalone HERMES launcher now reads those two deployment
declarations, clears inherited values when not enabled, and exports them to its Node child only
when explicitly declared. There is no routing default, fallback, batch/file operation,
autonomous spend, scheduler activation, admission, promotion, deployment, or live inference.
Workspace-controlled child processes launched by the cockpit explicitly discard both Cerebras
variables before execution; the long-lived credential must not flow into test or build jobs.

The later one-shot local command, **after reviewed lab-main integration and governed deployment**, is:

```powershell
powershell.exe -NoProfile -File "C:\HermesLab\williamos-runtime-64034e93-flat\scripts\execution-fabric\invoke-cerebras-smoke.ps1" -Model <catalog-model-id>
```

This wrapper requires William's HERMES-local interactive, hidden key entry. It gives the key and
enable flag only to its own Node child, makes one synthetic/public inference with a hard $0.01
cost ceiling, prints safe provider/model/usage/cost/duration/status metadata, and clears both
process variables in `finally`. Success also requires the fixed synthetic probe's expected
answer; an incorrect response is a typed failure and its content is never printed. Do not run
it during this implementation slice. The model ID is
an explicit operator selection from current public metadata, never a hard-coded production default.

The adapter checks the existing ContextPackage S1/S2 classification and bounded spend policy.
S1 is public; S2 must additionally attest synthetic or sanitized-for-external-processing content.
Missing/unknown/protected/local-only and flagged county, PACS, PII, credential, or confidential
content is refused before transport. A caller must classify *all* context, including system text
and tool definitions, before requesting external processing. No content belongs in retained evidence.

At call time, public metadata is obtained from the [official unauthenticated model endpoint](https://inference-docs.cerebras.ai/api-reference/models/public-models)
(`GET https://api.cerebras.ai/public/v1/models`). It determines model availability, capabilities,
and pricing; no fixed model list or prices are admitted. The [official chat-completions contract](https://inference-docs.cerebras.ai/api-reference/chat-completions)
and [authentication contract](https://inference-docs.cerebras.ai/api-reference/authentication)
define the POST and Bearer envelope. Discovery is metadata-only; it never sends a prompt or key.
Spend is reserved before inference against the highest current catalog tariffs, not only the
requested model's tariff; the receipt then calculates actual cost from the reported model and
binds the classified egress messages by digest, without retaining content.

The retained comparison entry point is [IF-05's evaluation corpus and acceptance rubric](05-acceptance-and-evaluation.md)
with the [whole-fabric benchmark matrix](18-if-05-fabric-benchmark-matrix.md). A later, separately
authorized sanitized live run should hold tasks constant across local 14B and eligible Cerebras
models and measure outcome quality, abstention, evidence fidelity, structured-output/tool
correctness, latency/throughput, token usage, actual cost per successful outcome, and failures.
No model is qualified, admitted, or production-ready on the strength of this offline adapter.

## Long-lived activation boundary

No dedicated HERMES API-key installer or vault is present in this repository. The running
`.env.local` belongs to the signed deployment tree; editing it in place invalidates the tree
attestation and can prevent restart. The current deploy script preserves that file and explicitly
guards its hash, so it is **not** a secret-update transaction. Do not edit the source or runtime
`.env.local` by hand.

Long-lived activation requires a separately reviewed, WilliamOS-governed transaction that:

1. integrates the exact reviewed/sealed revision into authoritative `lab/main` and builds it;
   the dependency-aware deployment path must stage the exact production lockfile with
   `-WithDependencies`, because the adapter's JSON Schema validator is a declared dependency;
2. accepts one hidden local key entry into a protected staged runtime configuration (never Git,
   command arguments, logs, chat, or a developer source tree);
3. atomically stages the bundle and configuration together, with rollback bytes and ACL checks;
4. attests/signs the **post-key** tree including `.env.local`, then performs one deliberate
   supervised deployment/restart and verifies the attested revision and health;
5. rolls back both code and configuration if admission or health verification fails.

That combined secret/deployment transaction is **not implemented by this PR**. Until it exists,
the process-only smoke above is the only approved future key handoff; the long-lived service must
remain disabled. One successful smoke would be evidence for evaluation, not model admission.
