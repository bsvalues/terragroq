# WO-MAO-036 — Provider Conformance Suite

Result: `PROVIDER_CONFORMANCE_SUITE_PASS / WO-MAO-037_READY`

## Scope

WO-MAO-036 adds a static suite-level provider conformance evaluator for the multi-agent operator
program. It verifies the common required contract set, validates the existing Codex session-only
conformance artifact, and explicitly excludes unavailable, disabled, or rejected providers from
certification.

This is not a provider dispatcher and not an unattended worker certification.

## Implemented Artifacts

- `scripts/multi-agent-operator/provider-conformance-suite.mjs`
- `scripts/multi-agent-operator/provider-conformance-suite-cli.mjs`
- `tests/multi-agent-provider-conformance-suite.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`

## Conformance Result

- `hosted-codex`: `SESSION_ONLY_CONFORMANT`
- `claude-code`: `DEFERRED_PROVIDER_UNAVAILABLE`
- `local-nested-codex`: `REJECTED`

The suite preserves the WO-MAO-029 truth that hosted Codex is a current-session/native-team surface,
not a service-compatible executable provider. It therefore records:

```text
enabledExecutableProviders=[]
executableWorkerCertified=false
dispatchPerformed=false
providerCallPerformed=false
```

## Required Contract Set

The suite requires the exact provider contract dimensions:

- dispatch
- status
- cancel
- evidence
- isolation
- retry
- recovery

It fails closed if the contract set is weakened, an executable provider is asserted without a proven
service transport, a disabled provider includes conformance material, or the Codex conformance record
is broadened.

## Safety Properties

- `dispatchPerformed`: `false`
- `providerCallPerformed`: `false`
- `executableWorkerCertified`: `false`
- `disabledProviderCertified`: `false`
- `durablePersistenceClaimed`: `false`
- `serviceWorkerClaimed`: `false`
- `runtimeActivationAllowed`: `false`
- `authorityGranted`: `false`
- `secretsExposed`: `false`
- `ownerRelayRequired`: `false`

## Validation

- `npm test -- --run tests/multi-agent-provider-conformance-suite.test.ts`: pass, 1 file / 4 tests
- `npm test -- --run tests/multi-agent-provider-conformance-suite.test.ts tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass, 5 files / 24 tests
- `git diff --check`: pass
- `npm run lint`: pass
- `npm test -- --run`: pass, 173 files / 1282 tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: pass

## Next Work Order

`WO-MAO-037 — Branch, commit, and push automation` is dependency-cleared.
