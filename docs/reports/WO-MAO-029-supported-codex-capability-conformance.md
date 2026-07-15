# WO-MAO-029 Supported Codex Capability Conformance

**Work Order:** `WO-MAO-029`

**Status:** `COMPLETE / SESSION_ONLY`

**Control-plane risk:** `R3`

**Supported task risk:** `R0`, `R1`

**Depends on:** `WO-MAO-015`, `WO-MAO-019`

## Outcome

The bounded Phase 1 hosted proof is now represented through the common provider capability schema
without inflating an interactive hosted session into a service transport. The exact result is
`SESSION_ONLY`: the current hosted Codex session may coordinate native team roles, with a concurrency
ceiling of three, only for exact `R0`/`R1` envelopes in `bsvalues/terragroq`.

The common capability deliberately records `availability=UNAVAILABLE` and
`serviceCompatible=false`. Under the provider-neutral WO-MAO-019 contract, `AVAILABLE` requires a
service-compatible executable surface. The session wrapper records the narrower positive fact:
`enabledForCurrentHostedSession=true`. Consequently, current-session native coordination can be
eligible while common provider-contract dispatch remains denied.

## Exact capability boundary

- provider: `hosted-codex`;
- adapter identity: `hosted-codex-session-native-team-v1`;
- requirements: `current-hosted-session`, `native-team-coordination`, `sanitized-evidence`;
- actions: `READ_REPOSITORY`, `RUN_VALIDATION`, `WRITE_RESERVED_PATHS`;
- roles: builder, coordinator, remediator, reviewer, verifier;
- repository: `bsvalues/terragroq`;
- maximum concurrency: `3`;
- cancellation, artifacts, and sanitized evidence: supported within the current session;
- durable transport, durable persistence, executable service worker, provider-contract dispatch,
  and authority minting: `false`.

Normalization pins every common capability field exactly. It rejects missing or substituted
requirements, actions, roles, repository, provider/adapter identity, availability, risk class,
concurrency, support flag, service compatibility, and authority behavior. Normalized objects and all
nested arrays/objects are recursively frozen and detached from caller input.

## Exact envelope boundary

`evaluateCodexSessionCoordination` first validates a full Work Order envelope v2, then requires the
canonical program/goal/loop identity, the exact repository, requirements, provider, no fallback
provider, exact bounded actions, a supported native team role, `R0` or `R1`, distinct team
identities, and an explicit `RUNTIME_ACTIVATION` prohibition. It retains:

```text
providerContractDispatchAllowed=false
dispatchPerformed=false
durablePersistenceClaimed=false
serviceWorkerClaimed=false
runtimeActivationAllowed=false
authorityGranted=false
```

`R2` and `R3` task envelopes fail closed on this surface. `WO-MAO-029` itself remains correctly
classified `R3` because it changes the control-plane contract; that classification does not authorize
the session adapter to execute `R3` tasks.

The rejected local runtime remains disabled. Issue `#357` is neither executed nor retried, and no
interactive authentication surface is represented as an unattended transport.

## Authoritative Phase 1 evidence

- PR `#364`, merge commit `8ec632aaacef731da2bc3e02958679b6c6273be6`;
- PR `#365`, merge commit `94795d37d4a844045f1461936c5744b89d2e28c0`;
- PR `#366`, merge commit `99cd0f20e4a214e8503784ff1226a9919d4b3889`.

These three records are exact conformance input, not free-form claims. Any PR number, order, or merge
SHA substitution fails closed.

## Mechanical proof

The canonical normalized artifact SHA-256 is:

```text
4fa4e64cc428a1e15c7f99165b84dc18ae4def1bc34f18e71c7f227bf5251c27
```

The adversarial suite recomputes that SHA from canonical JSON, proves key-order invariance, recursively
checks frozen nested values, rejects post-normalization mutation, and exercises capability inflation,
wrong repositories and roles, empty requirements, concurrency inflation, support substitutions,
service/authority/runtime assertions, `R2`/`R3` tasks, evidence substitution, all five owner counters,
and CLI typed failure.

Validation:

- focused Vitest: `1 file / 38 tests`, PASS;
- repository-wide Vitest: `162 files / 1,024 tests`, PASS;
- focused ESLint: PASS;
- Node syntax checks for module and CLI: PASS;
- Markdown MD018, secret-pattern sweep, and `git diff --check`: PASS.

No credentials, provider authentication, network request, runtime activation, GitHub write, production
write, issue retry, or owner action occurred.

## Owner-operation evidence

```text
OWNER_OPERATION_TOUCH_COUNT=0
OWNER_CREDENTIAL_TOUCH_COUNT=0
OWNER_DIAGNOSTIC_TOUCH_COUNT=0
OWNER_ROUTINE_DECISION_COUNT=0
OWNER_ROUTINE_CONTACT_COUNT=0
```
