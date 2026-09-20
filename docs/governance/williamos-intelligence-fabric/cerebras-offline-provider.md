# Cerebras Tier 3 provider — globally offline, Hello-only governed route

The generic Cerebras Tier 3 provider remains offline by default. It is not available to the
generic qualification runner, scheduler, batch/file operations, autonomous dispatch, or any
application other than the disposable Hello Application. Nothing in this integration admits a
Cerebras model as a WilliamOS-wide production model.

The disposable Hello Application has one deliberately narrow exception. Its AI route selector
defaults to the HERMES-local resident model and exposes two fixed, explicit external choices:
`gpt-oss-120b` and `qwen-3.8-27b`. An external call requires all of the following:

- the Hello-only routing feature is enabled in the signed runtime;
- the user explicitly selects one of the two Cerebras routes for that request; and
- the user explicitly approves the external egress disclosure.

An external failure is terminal for that proposal. It never falls back to a local model, and a
local failure never escalates to Cerebras. A new page load returns to the local default.

## Bounded Hello change

The external author receives only an S1 package: the owner's bounded change request and the
current contents of the three allowlisted Hello source files. It has no tools, shell, Git,
filesystem, network-selection, scheduler, deployment, or additional-path authority. The fixed
call allows at most 8,192 output tokens and reserves no more than **$0.03** using current catalog
pricing. The request uses provider JSON mode, and the source-only author then enforces the fixed
exact-key/path/size contract locally before any write. The provider must return strict JSON
containing complete replacement content for one to three allowlisted files; a substituted model,
malformed response, over-budget result, or out-of-scope path is refused.

Provider output is never written directly to canonical source. HERMES applies it only inside the
existing isolated proposal worktree, validates the changed paths and test result, and presents
the proposal with provider, actual model, token usage, calculated cost, cost ceiling, digest, and
duration evidence. Canonical source changes only after the user reviews the proposal and selects
**Apply**. Reject/Discard closes the proposal without applying it.

The fixed entry points are:

- `scripts/execution-fabric/cerebras-hello-change.mjs` — validates the bounded S1 package, makes
  one structured external request, and returns a content-free execution receipt plus validated
  replacements;
- `scripts/execution-fabric/invoke-cerebras-hello-change.ps1` — obtains the credential and starts
  exactly one Node child for that request; and
- `scripts/execution-fabric/external-model-api.mjs` — performs catalog discovery, egress checks,
  spend reservation, transport, response validation, and safe receipt construction.

## Credential boundary

The API key remains in the current interactive HERMES user's Windows Generic Credential named
`WilliamOS/Cerebras/API-Key`, with username metadata `CEREBRAS_API_KEY`. It is not copied into
Git, `.env.local`, the Next.js runtime environment, command arguments, logs, chat, tests, build
jobs, or a developer source tree.

For an explicitly approved Hello request, the PowerShell wrapper first validates the fixed wrapper
envelope and selected model, then reads only that exact credential target. The fixed Node child
validates every nested file entry before transport. The wrapper never enumerates credentials and has
no prompt, target override, environment, file, or module fallback. The key and enable flag exist
only in the wrapper and its one fixed Node child, and both environment values are removed in
`finally`. Native credential bytes are zeroed before `CredFree`; the managed BSTR is released
with `ZeroFreeBSTR`; and the `SecureString` is disposed. Workspace-controlled child processes
outside this wrapper continue to receive empty/disabled Cerebras variables.

Credential creation and rotation remain owner actions in the interactive HERMES Windows
Credential Manager. The runtime feature flag admits the route but does not contain or attest the
secret. General or unattended Cerebras activation would require a separate reviewed WilliamOS
transaction; this Hello-only on-demand bridge does not grant it.

## Independent one-shot smoke

The synthetic smoke remains available as a separate credential and provider check:

```powershell
$VersionedRoot = "C:\HermesLab\WilliamOS-Disposable\williamos-hello-ai-<release-sha12>"
powershell.exe -NoProfile -File "$VersionedRoot\source\scripts\execution-fabric\invoke-cerebras-smoke.ps1" -Model <catalog-model-id>
```

The smoke makes one synthetic/public inference with a hard $0.01 cost ceiling and prints only
safe provider/model/usage/cost/duration/status metadata. It is evaluation evidence, not model
admission and not an activation path for any application.

## Provider contract and evaluation

At call time, public metadata comes from the
[official unauthenticated model endpoint](https://inference-docs.cerebras.ai/api-reference/models/public-models)
(`GET https://api.cerebras.ai/public/v1/models`). The Hello route pins its two user-visible model
IDs, but each request must still find the selected model and required JSON-mode capability
in current provider metadata. Spend is reserved before inference against current catalog tariffs,
and the receipt calculates actual cost from the provider-reported model and usage. The
[official chat-completions contract](https://inference-docs.cerebras.ai/api-reference/chat-completions)
and [authentication contract](https://inference-docs.cerebras.ai/api-reference/authentication)
define the POST and Bearer envelopes. Discovery is metadata-only and sends neither prompt nor key.

The generic adapter continues to enforce ContextPackage classification and bounded spend policy.
S1 is public. S2 requires an explicit synthetic or sanitized-for-external-processing attestation.
Missing, unknown, protected, local-only, county, PACS, PII, credential-bearing, or confidential
content is refused before transport. The Hello route is intentionally stricter: its fixed package
is S1 only. No prompt or returned source content belongs in retained execution evidence.

The retained comparison entry point remains
[IF-05's evaluation corpus and acceptance rubric](05-acceptance-and-evaluation.md), together with
the [whole-fabric benchmark matrix](18-if-05-fabric-benchmark-matrix.md). Broader model
qualification requires a separate authorized evaluation and admission decision.
