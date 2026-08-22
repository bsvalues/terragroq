# WO-AEH-052 — Atlas runtime-role and TLS policy repository substage

Result: `REPOSITORY_POLICY_VALIDATED / INDEPENDENT_REVIEW_PASS / R3_APPLY_BLOCKED`. This is a repository and cached-disposable-PostgreSQL result, not an Atlas installation or live proof.

The remediation replaces digest-only planning with a closed `aeh.atlas-catalog-snapshot.v3` contract. The snapshot contains role attributes and memberships, normalized database/schema/table/sequence/function ACL grants including grant options and implicit owner/default semantics, default privileges, every `ai_evalops` function owner/security-definer/search-path observation, exact HBA preimage bytes, and hashes of the policy plus the three checked-in input templates. Unknown fields, unsafe identities, malformed principals, missing observations, HBA digest mismatch, and changed template bytes fail closed.

`renderAtlasRoleChange` deterministically renders snapshot-bound apply SQL, rollback SQL, replacement HBA bytes, and byte digests. The cached PostgreSQL fixture executes the rendered bytes derived from the checked-in templates rather than a hand-written setup approximation. Apply revokes PUBLIC/runtime database, schema, table, sequence, function, membership, and observed default authority before granting only database CONNECT, schema USAGE, and the exact wrapper allocation:

- `aeh_coordinator`: `request_worker_cancellation_enveloped(...)`
- `aeh_worker`: `pull_worker_envelope(...)`, `worker_heartbeat(...)`, and `acknowledge_worker_cancellation_enveloped(...)`

Every cross-role wrapper grant is denied. The schema and every function transfer to the `NOLOGIN`, `NOINHERIT`, non-superuser `aeh_migration_owner`; the existing four SECURITY DEFINER wrappers retain `search_path=pg_catalog, ai_evalops, pg_temp`. Runtime roles receive no direct table, sequence, helper-function, DDL, role-membership, database-CREATE/TEMP, extension, COPY PROGRAM, create-role, or create-database authority. The migration owner receives the table/sequence authority needed by its SECURITY DEFINER wrappers, but is not a login or runtime membership parent.

The fixture seeds nontrivial preimages: PUBLIC and runtime database/schema ACLs, direct table and sequence grants, a function grant with grant option, schema and global default privileges, a runtime role membership, all function metadata/ACL semantics, and nonempty HBA bytes. It applies migrations 0000–0007, executes rendered apply, proves exact positive and cross-denied wrapper access, exercises the complete negative matrix, creates future objects as the migration owner to prove safe defaults, then executes rendered rollback. A canonical catalog projection of ACLs, default ACLs, role attributes/memberships, function owners/security/search paths, and schema owner is byte-identical before apply and after rollback. HBA rollback bytes and digest are also exact.

Validation passed twice consecutively: 5/5 tests per run using cached `postgres:16`, `--pull=never`. Both uniquely named containers were removed and zero matching containers remained. Migration 0007 was not changed; its search-path hardening and manifest digest remain intact.

No Atlas connection, live database, role, certificate, HBA file, service, secret, network endpoint, image pull, or host state was touched. Exact Atlas catalog/HBA discovery, certificate issuance, backup/restore evidence, service restart, leadership/fencing, installation, activation, and uninstall remain R3-authority-gated and unproven.

Rollback for this repository substage is removal/reversion of only the WO052 policy, templates, renderer, test, report, and evidence. Runtime rollback is rendered only from a fresh exact snapshot and must not be applied without separate R3 authority.

## Independent review closure

- Reviewer: `/root/packet_assurance` (independent of the final builder lane)
- Verdict: `PASS_REPOSITORY_POLICY_ONLY`; zero unresolved repository-policy blockers
- Revalidation: cached PostgreSQL 16 suite `5/5 PASS` twice with `--pull=never`; no disposable containers remained
- Privilege proof: exact rendered apply bytes, NOLOGIN owner, four signature-specific wrappers, cross-role denials, full DML/DDL/sequence/helper/COPY/TEMP/database/role negatives, and future default privileges passed
- Reversal proof: rendered rollback restored the canonical seeded catalog projection byte-for-byte and restored exact HBA preimage bytes/digest
- Integrity: all recorded template, renderer, policy, migration and test hashes matched; scoped diff validation passed
- Required remaining gate: exact R3 Atlas discovery, certificate/CIDR decisions, backup/restore, catalog application, HBA reload, service restart, leadership/fencing, canary, rollback, and uninstall proof. This substage does not complete WO-AEH-052.
