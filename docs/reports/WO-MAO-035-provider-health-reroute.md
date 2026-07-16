# WO-MAO-035 — Provider Health, Circuit Breakers, and Reroute

Result: `PROVIDER_HEALTH_REROUTE_PASS / WO-MAO-036_READY`

## Scope

WO-MAO-035 adds a static, deterministic provider-health evaluator for the multi-agent operator
program. It classifies provider failure observations, opens bounded circuit-breaker/backoff states,
and selects healthy fallback providers when reroute is permitted.

This is control-plane proof only. It does not call a provider, dispatch work, persist runtime state,
activate a worker, create a service, or grant authority.

## Implemented Artifacts

- `scripts/multi-agent-operator/provider-health-reroute.mjs`
- `scripts/multi-agent-operator/provider-health-reroute-cli.mjs`
- `tests/multi-agent-provider-health-reroute.test.ts`
- `components/operator/multi-agent-capability-registry.ts`
- `components/operator/multi-agent-operator-registry.ts`

## Classification Rules

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

## Validation

- `npm test -- --run tests/multi-agent-provider-health-reroute.test.ts`: pass, 1 file / 5 tests
- `npm test -- --run tests/multi-agent-provider-health-reroute.test.ts tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass, 5 files / 25 tests
- `git diff --check`: pass
- `npm run lint`: pass
- `npm test -- --run`: pass, 172 files / 1278 tests
- `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build`: pass

## Next Work Order

`WO-MAO-036 — Provider conformance suite` is dependency-cleared.
