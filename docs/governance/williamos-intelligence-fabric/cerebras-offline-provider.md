# Cerebras optional Tier 3 provider — offline-ready candidate

The existing `scripts/execution-fabric/external-model-api.mjs` Tier 3 adapter exposes
`callCerebrasModelApi`. It is disabled unless `WILLIAMOS_CEREBRAS_ENABLED=true` is explicitly
set and `CEREBRAS_API_KEY` is available through HERMES's existing server-side secret mechanism.
Neither setting is installed by this change. This is an explicit call only: no routing default,
automatic fallback, batch/file operation, scheduler activation, deployment, or live inference.

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

The retained comparison entry point is [IF-05's evaluation corpus and acceptance rubric](05-acceptance-and-evaluation.md)
with the [whole-fabric benchmark matrix](18-if-05-fabric-benchmark-matrix.md). A later, separately
authorized sanitized live run should hold tasks constant across local 14B and eligible Cerebras
models and measure outcome quality, abstention, evidence fidelity, structured-output/tool
correctness, latency/throughput, token usage, actual cost per successful outcome, and failures.
No model is qualified, admitted, or production-ready on the strength of this offline adapter.
