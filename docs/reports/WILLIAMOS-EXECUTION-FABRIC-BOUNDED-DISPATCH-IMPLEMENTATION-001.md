# WilliamOS Execution Fabric bounded dispatch implementation

Issue: `#538`

## Result

`PHASE_3_SINGLE_SHOT_IMPLEMENTATION: READY_FOR_REVIEW`

This change converts the static dispatch-contract proof into a deliberately narrow executable path
without enabling a scheduler. The only implemented adapter is one fixed HERMES loopback Ollama
inference template.

## Exact template

- Node: `hermes-node`
- Resident identity: `resident-hermes@hermes-node`
- Endpoint: `http://127.0.0.1:11434/api/generate`
- Model: `llama3.2:3b`
- Prompt artifact: `config/execution-fabric/task-prompts/hermes-loopback-local-inference-v1.txt`
- Expected response: `HERMES_DISPATCH_001_OK`
- Calls: one
- Timeout: 60 seconds
- Redirects: rejected
- Response ceiling: 65,536 bytes
- Data: non-sensitive only

The adapter exposes no command, shell, URL, model, prompt, header, environment, provider, node, or
retry override.

## Authority and evidence chain

Execution requires all of the following:

1. The exact reviewed template and prompt digest.
2. A reviewed scope artifact in `config/execution-fabric/dispatch-authority-scopes/`.
3. Separate activation evidence in `docs/reports/execution-fabric-dispatch-activations/`.
4. A later single-use registry entry binding both exact artifact digests and commits.
5. Strict scope-before-activation-before-trusted-main Git ancestry.
6. A fresh, observed rank-one HERMES placement receipt.
7. An admission artifact reviewed as exact bytes on `origin/main`.
8. A durable local lease and monotonically increasing fencing token.

The activation registry is empty in this change. Therefore the executable path remains fail-closed.

## Exactly-once boundary

Ollama does not expose a server-side idempotency key. The truthful guarantee is at-most-one request
initiation. WilliamOS atomically records `REQUEST_STARTED`, the request digest, and the current fence
before transmitting. A crash after that point is terminal
`OUTCOME_UNKNOWN_DO_NOT_REPLAY`; silence is never converted to success and no automatic retry or
re-placement occurs.

## Preserved walls

- Scheduler: `OFF / not-granted`
- Autonomous scheduling: false
- Queue polling/background worker: absent
- Arbitrary shell: absent
- Silent re-placement: forbidden
- AEGIS compute authority: not granted
- AEGIS storage/NAS/backup authority: not granted
- ATLAS authoritative-state mutation: forbidden
- TerraFusion/county/PACS/protected data: forbidden
- External provider and paid overage: forbidden
- Issue `#357` runtime: not reused
- Execution performed by this implementation change: false
