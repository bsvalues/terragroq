# WO-MAO-035 — Provider Health, Circuit Breakers, and Reroute

Result: `PASS / COMPLETE`

## Scope

WO-MAO-035 replaces the invalidated historical provider-health fixture with a zero-input canonical
registry. Callers cannot supply provider records, observations, breaker state, reroute requests, or
budgets. The only success path is the sealed local registry embedded in
`scripts/multi-agent-operator/provider-health-reroute.mjs`.

## Proof

- Registry: `williamos-provider-health-reroute`
- Registry version: `1`
- Registry content hash:
  `50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3`
- Result hash:
  `678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5`
- Evidence record:
  `components/operator/multi-agent-provider-health-registry.ts`
- Evidence record hash:
  `50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a`

## Provider State

- `hosted-codex`: `BACKOFF / RATE_LIMITED`
- `hosted-codex-secondary`: `ACTIVE / HEALTHY`
- `claude-code`: `UNAVAILABLE / PROVIDER_UNAVAILABLE`

The model selects `hosted-codex-secondary` as the bounded static fallback for WO-MAO-035. It does
not treat unavailable Claude as a fallback while the provider remains unavailable.

## Circuit Breaker

The canonical registry records a stateful breaker transition:

- Transition: `breaker-wo-mao-035-hosted-codex-backoff-v1`
- Provider: `hosted-codex`
- From: `ACTIVE`
- To: `BACKOFF`
- Observation: `obs-wo-mao-035-hosted-codex-rate-limit-v1`
- Reason: `RATE_LIMITED`

The evaluator verifies that the breaker transition matches the trusted observation-derived health
state. Registry mutations fail the integrity wall before any success artifact can be emitted.

## Safety Properties

- `dispatchPerformed`: `false`
- `providerCallPerformed`: `false`
- `durablePersistenceClaimed`: `false`
- `serviceWorkerClaimed`: `false`
- `runtimeActivationAllowed`: `false`
- `authorityGranted`: `false`
- `secretsExposed`: `false`
- `ownerRelayRequired`: `false`

No provider call, GitHub automation, runtime activation, persistence, authority grant, secret access,
or owner relay was added.

## Validation

- `npm test -- --run tests/multi-agent-provider-health-reroute.test.ts
  tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts
  tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass

Full validation is recorded in the PR gate.

## Next Transition

WO-MAO-035 is complete. The multi-agent operator queue now marks WO-MAO-036 — Provider Conformance
Suite as `READY` through its retained prerequisites:

- WO-MAO-028
- WO-MAO-029
- WO-MAO-030
- WO-MAO-031
- WO-MAO-032
- WO-MAO-034
- WO-MAO-035

WO-MAO-033 remains `DEFERRED_PROVIDER_UNAVAILABLE` and resumable. No settlement or waiver is
generalized beyond the already completed WO-MAO-034 gate.
