# WO-MAO-036 — Provider Conformance Suite

Result: `INVALIDATED / REPROOF_REQUIRED / PENDING`

## Scope

The original merged report claimed suite-level provider conformance by accepting caller-supplied
provider records plus the WO-MAO-029 fixture and projecting hardcoded contract coverage. That proof is
superseded because no provider operation, trusted observation, or executable adapter transaction was
required to manufacture the conformance result.

The historical implementation remains preserved behind an unconditional typed invalidation wall. It
cannot emit a success artifact until WO-MAO-031, WO-MAO-034, and WO-MAO-035 are re-proved and the
suite is redesigned to consume independently captured operational evidence.

## Historical original artifacts (superseded)

- `scripts/multi-agent-operator/provider-conformance-suite.mjs`
- `scripts/multi-agent-operator/provider-conformance-suite-cli.mjs`
- `tests/multi-agent-provider-conformance-suite.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`

## Historical original result (superseded)

The following projection is retained as redesign input only and is not current conformance evidence:

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

## Historical original required contract set (superseded)

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

## Historical original validation (superseded)

These runs described the invalidated implementation and do not prove the current Work Order:

- `npm test -- --run tests/multi-agent-provider-conformance-suite.test.ts`: pass, 1 file / 4 tests
- `npm test -- --run tests/multi-agent-provider-conformance-suite.test.ts tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass, 5 files / 24 tests
- `git diff --check`: pass
- `npm run lint`: pass
- `npm test -- --run`: pass, 173 files / 1282 tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: pass

## Next transition

`WO-MAO-036` is `PENDING / REPROOF_REQUIRED`. The required sequence is WO-MAO-031, WO-MAO-034,
WO-MAO-035, then WO-MAO-036. Phase 5 remains pending after that ordered chain.
