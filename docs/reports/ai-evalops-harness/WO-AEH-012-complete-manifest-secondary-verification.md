# WO-AEH-012 — Complete-manifest secondary verification

Result: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / NOT_INTEGRATED`

HermesLab base and head: `0481061acf1f683688a00b09795647d0288c7232`.

## Outcome

`HermesLab:aegis/complete-manifest-verification.mjs` defines a pure, fail-closed comparison contract
for complete primary and secondary manifests. HermesLab is a separate physical checkout, so the
repository-qualified path is recorded instead of a misleading relative link.

Both sides must:

- use the exact schema and generation;
- declare their correct `PRIMARY` or `SECONDARY` role;
- contain exactly the caller-declared protected-source set;
- contain at least one entry for every protected source;
- use unique source IDs and unique safe relative POSIX paths;
- provide nonnegative safe-integer sizes and lowercase SHA-256 digests; and
- contain no undeclared fields.

The verifier canonicalizes object keys, expected source IDs, manifest source IDs, and entry paths
with one explicit UTF-16 code-unit comparator, then requires exact equality of source ID, relative
path, size, and SHA-256 for every entry. It does not depend on host locale. Missing, extra, corrupt,
duplicate, generation-
mismatched, role-mismatched, malformed, or path-unsafe content fails before a match result. A match
returns bounded digests and counts with `mutationPerformed: false`.

## Validation

```text
node --test aegis/tests/complete-manifest-verification.test.mjs
tests: 15
pass: 15
fail: 0

git diff --check -- aegis/complete-manifest-verification.mjs aegis/tests/complete-manifest-verification.test.mjs
PASS
```

Negative tests cover missing and extra protected sources, changed hash and size, duplicate sources
and paths, empty entries, malformed hash/size, unknown fields, generation/role ambiguity, duplicate
expected sources, traversal, absolute Windows/POSIX paths, backslashes, empty/dot segments, and
wildcards. A positive permutation vector covers mixed-case and punctuation-bearing source IDs and
paths in reversed orders and asserts the exact canonical order.

Artifact digests:

- module: `03cdfb2a8c0c002eb3fb16718846c8fb72805f857549497aeafe01f5eff939e5`
- test: `387e4e33c86a68d3a8b0b92a16925f44e24a63edcb27b9669103b3c556315c16`
- retained validation evidence:
  [`WO-AEH-012-complete-manifest-verification.json`](./evidence/WO-AEH-012-complete-manifest-verification.json)

## Scope, rollback, and non-proof

Only two new HermesLab contract/test files and this WO's unique report/evidence were created.
`aegis/backup-v1.sh` was not edited. No backup mount, backup generation, network, container, database,
service, host, retention, copy, deletion, or pruning operation was accessed or performed. Existing
dirty state was preserved.

Rollback before merge is deletion of the four new reserved artifacts. It does not touch a backup,
historical evidence, or foreign state.

This proves the standalone synthetic equality contract only. It does not prove that the live backup
script emits the contract, that a real complete copy matches, that restore is successful, or that
retention is safe. Integration and live proof remain gated by later Work Orders. No authority or
maturity promotion is created.

Independent reviewer `/root/packet_matrix` reran 15 tests, syntax and diff
checks, verified uniform code-unit ordering, mixed-case/punctuation permutations,
all fail-closed equality cases, artifact digests, and non-live boundaries, and
returned `PASS` with no blocking findings.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
