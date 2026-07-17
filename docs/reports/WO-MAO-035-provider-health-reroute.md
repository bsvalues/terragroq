# WO-MAO-035 — Provider Health, Circuit Breakers, and Reroute

Result: `INVALIDATED / REPROOF_REQUIRED / PENDING`

## Scope

The original merged report claimed a static provider-health evaluator that classified caller-supplied
failure observations, projected circuit-breaker/backoff state, and selected fallback providers. That
proof is superseded: caller-invented provider records, stale observations, and stateless breaker input
could manufacture a passing result without a host observation or durable state transition.

The historical implementation remains preserved behind an unconditional typed invalidation wall. It
cannot emit a success artifact until WO-MAO-031 and WO-MAO-034 are re-proved and WO-MAO-035 is
redesigned around trusted observations and stateful breaker transitions.

## Historical original artifacts (superseded)

- `scripts/multi-agent-operator/provider-health-reroute.mjs`
- `scripts/multi-agent-operator/provider-health-reroute-cli.mjs`
- `tests/multi-agent-provider-health-reroute.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`

## Historical original classification rules (superseded)

The following rules are retained as redesign input only and are not current completion evidence:

- `401` / `403` -> `QUARANTINED` with `AUTHORIZATION_WALL`
- `429` -> `BACKOFF` with bounded `RATE_LIMITED` retry delay
- `5xx` -> `BACKOFF` with `PROVIDER_5XX`
- network failures -> `BACKOFF` with `NETWORK_WALL`
- timeouts -> `BACKOFF` with `TIMEOUT`
- malformed output -> `QUARANTINED` with `MALFORMED_OUTPUT`
- deterministic failures -> `QUARANTINED` with no reroute permission
- provider-unavailable lanes remain `UNAVAILABLE` / `PROVIDER_UNAVAILABLE`

## Safety Properties

- `dispatchPerformed`: `false`
- `providerCallPerformed`: `false`
- `durablePersistenceClaimed`: `false`
- `serviceWorkerClaimed`: `false`
- `runtimeActivationAllowed`: `false`
- `authorityGranted`: `false`
- `secretsExposed`: `false`
- `ownerRelayRequired`: `false`

The evaluator fails closed if provider isolation is false, raw credential access is true, an
observation references an unknown provider, input fields are unknown or missing, or provider identity
formats are unsafe.

## Provider State

`claude-code` remains `UNAVAILABLE / PROVIDER_UNAVAILABLE` and resumably deferred. The static reroute
model does not treat Claude as a fallback while unavailable. Healthy hosted Codex fallback lanes may be
selected only when repository scope, required roles, provider health, and reroute budget allow it.

## Historical original validation (superseded)

These runs described the invalidated implementation and do not prove the current Work Order:

- `npm test -- --run tests/multi-agent-provider-health-reroute.test.ts`: pass, 1 file / 5 tests
- `npm test -- --run tests/multi-agent-provider-health-reroute.test.ts tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass, 5 files / 25 tests
- `git diff --check`: pass
- `npm run lint`: pass
- `npm test -- --run`: pass, 172 files / 1278 tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: pass

## Next transition

`WO-MAO-035` is `PENDING / REPROOF_REQUIRED`. The required sequence is WO-MAO-031, WO-MAO-034,
WO-MAO-035, then WO-MAO-036. Phase 5 remains pending after that ordered chain.
