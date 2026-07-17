# WO-MAO-036 — Provider Conformance Suite

Result: `PASS / COMPLETE`

## Scope

WO-MAO-036 replaces the invalidated caller-supplied conformance fixture with a zero-input canonical
registry. Callers cannot supply provider records, contract sets, fixture coverage, executable-worker
claims, or prerequisite evidence. The only success path is the sealed registry embedded in
`scripts/multi-agent-operator/provider-conformance-suite.mjs`.

## Proof

- Registry: `williamos-provider-conformance-suite`
- Registry version: `1`
- Registry content hash:
  `cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733`
- Result hash:
  `79117c7b2046c673e45b2b6f71f6e229ee7868f907bb7e0dd05024ad737ca1b4`
- Codex conformance content hash:
  `052c437518a59b15c3d3c5e3553765a00dcf8d94b2eba76b55f9b37f845c0d38`
- WO-MAO-035 evidence hash:
  `50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a`
- Evidence record:
  `components/operator/multi-agent-provider-conformance-registry.ts`
- Evidence record hash:
  `3283799cc653436b8a0d35575b08fc344611e3ec289afe8ca90e5de1db295f80`

## Provider Conformance State

- `hosted-codex`: `SESSION_ONLY_CONFORMANT`
- `claude-code`: `DEFERRED_PROVIDER_UNAVAILABLE`
- `local-nested-codex`: `REJECTED`

Hosted Codex remains a current-session/native-team surface, not a service-compatible executable
provider. The suite certifies no executable worker.

## Required Contract Coverage

The canonical suite pins the exact provider contract set:

- `cancel`
- `dispatch`
- `evidence`
- `isolation`
- `recovery`
- `retry`
- `status`

Hosted Codex coverage remains session-only and non-executable:

- dispatch: `DENIED_BY_CONFORMANCE`
- status: `STATIC_CONFORMANCE_RECORD`
- cancel: `CURRENT_SESSION_SUPPORTED`
- evidence: `SANITIZED_EVIDENCE_SUPPORTED`
- isolation: `OWNER_TOUCH_AND_SECRET_BOUNDARIES_ENFORCED`
- retry: `CURRENT_SESSION_BOUNDED`
- recovery: `ORIGINAL_BUILDER_REMEDIATION_AND_REVIEW`

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

No provider dispatch, provider call, executable-worker certification, GitHub automation, runtime
activation, persistence, authority grant, secret access, or owner relay was added.

## Validation

- `npm test -- --run tests/multi-agent-provider-conformance-suite.test.ts
  tests/multi-agent-operator-registry.test.ts tests/multi-agent-capability-registry.test.ts
  tests/portfolio-operator.test.ts tests/portfolio-operator-surface.test.ts`: pass

Full validation is recorded in the PR gate.

## Next Transition

WO-MAO-036 is complete. The multi-agent operator queue now marks WO-MAO-037 — Branch, Commit, and
Push Automation as `READY` through its retained prerequisites:

- WO-MAO-007
- WO-MAO-025
- WO-MAO-026
- WO-MAO-036

WO-MAO-033 remains `DEFERRED_PROVIDER_UNAVAILABLE` and resumable. The rejected local nested runtime
remains rejected and is not part of the eligible dependency chain.
