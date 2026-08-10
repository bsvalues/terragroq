# Execution Fabric scoped authority contract

Issue: `#538`

Status: `CONTRACT_READY_ACTIVATION_EMPTY`

## Purpose

The Phase 2 shadow lane now has a versioned authority contract that binds a proposed execution to an
immutable, canonical scope artifact. The contract exists so a placement recommendation cannot become
execution through a reference-only registry row or through candidate-authored scope.

## Bound scope

The canonical scope digest covers:

- authority reference and Work Order;
- workload identity and workload-contract digest;
- risk class;
- task-template identity and task-template-contract digest;
- repository and environment scope;
- allowed and forbidden actions;
- data classification and owner-decision conditions;
- allowed canonical nodes.

Scope artifacts use RFC 8785 JCS bytes plus one newline. Missing, extra, malformed, duplicate,
unsorted, overlapping, executable-like, or secret-like scope data fails closed.

## Proof chain

```text
immutable scope artifact
  -> scope SHA-256
  -> reviewed scope commit
  -> separately merged future-dated activation entry
  -> activation-entry SHA-256 and activation commit
  -> resident preflight settlement
  -> exact producer facts
  -> scoped outcome evidence
  -> independent review naming execution commit and scope digest
  -> reviewed admission
  -> replay settlement
```

The activation commit must be strict trusted-main ancestry after the scope review and must be merged
before `valid_from`. The same scope and activation digests are rechecked before fact capture,
candidate materialization, admission, and replay.

## Legacy boundary

`WO-EF-SHADOW-001` remains immutable `0.1` replay evidence. Its retained artifacts and replay digest
are not rewritten to imply that the new scope contract existed before its execution. New scoped
observations use the `0.2` lane; partial or unknown scoped evidence cannot fall back to `0.1`.

## Current authority state

- scoped activation registry entries: `0`
- WO-EF-SHADOW-002 authority: `NOT_GRANTED`
- WO-EF-SHADOW-003 authority: `NOT_GRANTED`
- execution performed in this change: `false`
- scheduler enabled: `false`
- autonomous dispatch enabled: `false`
- AEGIS compute authority granted: `false`
- AEGIS storage, NAS, or backup authority granted: `false`

The next valid step is a separate PR containing reviewed immutable scope artifacts. A later,
future-dated activation PR may reference those reviewed bytes. No workload may execute from this
contract PR.
