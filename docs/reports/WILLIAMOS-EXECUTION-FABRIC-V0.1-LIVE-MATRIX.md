# WilliamOS Execution Fabric v0.1 live matrix

Status: `FOUR_NODE_LIVE_PROOF_ASSEMBLED / INDEPENDENT_REVIEW_PENDING / SCHEDULER_OFF`

PR: `#532`

The matrix separates declared role, retained live probe evidence, and authority. All four physical nodes were captured in one freshness window and admitted only after exact hostname, OS-family, probe implementation, and hashed machine-identity checks passed. Raw probes and the generated snapshot remain ignored host-local artifacts; their exact hashes below bind this reviewed report to the evidence without publishing machine inventory as repository data.

## Node matrix

| Node | Canonical role | Evidence state | Observed capacity | Runtime/health interpretation | Placement state |
|---|---|---|---|---|---|
| OMEN | Cockpit, interactive development, burst compute | Observed at `2026-08-10T02:51:23.7888643Z`; SHA-256 `B71E62EC1D8A4BD4CA8EB3B5E2E4851C8DC15D8772886CE3392EBD4A6EEEF13E` | Ryzen 9 8940HX, 16C/32T; 32 GiB DDR5; RTX 5060 Laptop GPU; two physical disks | WSL and SSH observed running; Docker unavailable; CIM fallback used because the Windows Storage module was unavailable | Evidence admitted; interactive role only; no durable-state authority |
| HERMES-NODE | AI/GPU/agent execution | Observed at `2026-08-10T02:51:24.8523578Z`; SHA-256 `0055A8765DDE3B436A2F71E89E7AE053A82BE0C89575A38FCF641B29D24A5C63` | Core i7-5960X, 8C/16T; 32 GiB DDR4; RTX 3050 6 GiB; three disks | Docker 28.5.1, SSH, WSL, and loopback Ollama observed healthy | Evidence admitted; existing AI/GPU candidate role retained; no durable-state authority |
| ATLAS | Authoritative DB/state, Forge, retrieval | Observed at `2026-08-10T02:51:25.682636Z`; SHA-256 `F8929A3E216AA0574D1E8F3176ABB4916B55301E2204D52D897ED4BEA4794BCF` | Xeon E5-2690 v4, 14C/28T; 32 GiB ECC DDR4; three disks; no GPU | Docker 29.7.2, SSH, and `/forge` observed; database services were not observed by this probe; SMART remains incomplete for `/dev/sdc`; `/dev/sda` raw reallocation value remains uninterpreted | Evidence admitted; ATLAS alone retains durable-state authority; noisy batch remains constrained |
| AEGIS | CPU batch, CI/build/test, hashing, compression, ETL, Docker worker | Observed at `2026-08-10T02:51:25.986775Z`; SHA-256 `01EE5810B6876612525038D8513535E3AAB94457BFCB6DE7055D8668FBBD030D`; host reached through the previously proven Hermes trust chain; OMEN retained ED25519 fingerprint `SHA256:N+YNbMg3nUb0tX7ZYLJfJSt9f0dUOukBUNLyYb1WByo` | Xeon E5-2690 v4, 14C/28T; 16 GiB ECC DDR4; 2 TB SN850X NVMe; three SATA devices observed | Docker 29.7.2 and SSH observed running. The failed SATA device reports corrupted identity and no usable capacity. The healthy `ST1000DM003` remains occupied. An additional `ST31000528AS` was observed but has no SMART proof in this capture. | Evidence admitted for compute-readiness review only; `not-schedulable-unknown-disk-capacity` retained; compute authority and all storage/NAS/backup authority remain ungranted |
| Azure | Separately authorized external envelope | Declared policy only | Unknown | No implicit provider, cost, or data authority | Non-selectable |

## Authority invariants

- Scheduler state is explicitly `disabled`; scheduler authority is `not-granted`.
- ATLAS alone retains authoritative durable-state authority.
- OMEN, HERMES-NODE, and AEGIS cannot gain durable-state authority through probe overlay.
- AEGIS's intended compute role and trusted evidence are recorded, but compute placement remains blocked because compute authority is not granted. Storage/NAS/backup remain blocked pending separate storage proof and authority.
- County/PACS writes, protected-data expansion, destructive disk operations, implicit cloud use, and paid execution remain blocked.
- The failing AEGIS 4 TB disk is evidence only. No wipe or destructive action is authorized.

## Exact assembled snapshot

- Generated at: `2026-08-10T02:51:54.321Z`.
- Snapshot SHA-256: `61A286B917A9319E42852D71774F8357DA5F31A313750EA25DCC74326D383CA5`.
- Snapshot bytes: `37517`.
- Physical evidence confidence: OMEN `observed`; HERMES-NODE `observed`; ATLAS `observed`; AEGIS `observed`.
- Azure remains a declared, non-selectable policy envelope.
- Scheduler state remains `disabled`; scheduler authority remains `not-granted`.

The first AEGIS capture correctly failed closed because the corrupted disk reported zero capacity. The narrow remediation retains that physical device with `capacity_bytes: null`, emits an explicit warning, and adds `not-schedulable-unknown-disk-capacity`. It does not infer the failed drive's model, serial, or usable size and does not grant storage authority.

## Control-side corrections in this head

- Replaced provisional `t5810-2` identity with canonical `aegis` across seed, assembler, design, and probe workflow.
- Added explicit disabled scheduler state to schema, seed, snapshot, and tests.
- Added global immutable disk-serial collision rejection.
- Bound observed evidence to canonical host-derived node IDs and trusted hashed machine identities.
- Added complete nested schema validation before observed promotion or snapshot publication.
- Enforced the exact v0.1 node roster and authority envelope.
- Normalized disk serials and rejected duplicate disk IDs and ambiguous blank serials.
- Delayed snapshot publication until semantic invariants pass.
- Invalidated stale output before assembly and atomically renamed successful snapshots.
- Rejected mismatched timestamps, non-array resource collections, and future-dated probes.
- Added Windows CIM fallbacks when Storage or NetAdapter modules are unavailable.
- Removed the unbounded `wsl.exe --status` call from the Windows probe.
- Ignored generated local probe artifacts so raw transient inventory cannot be committed accidentally.
- Retained non-positive physical-disk capacity as explicit unknown evidence and fenced the node from storage placement instead of dropping the device or inventing capacity.
- Pinned the trusted hashed machine identities for HERMES-NODE, ATLAS, and AEGIS from the retained, hostname-bound live probes.

## Validation evidence

Validation was run after the live-probe mismatch remediation and before publishing the reviewed head:

- `node_modules/vitest/vitest.mjs run tests/execution-fabric-registry.test.ts`: `47 passed`.
- Broader suite excluding the separately host-dependent TerraFusion lab preflight: `261 files passed`, `2663 tests passed`, `2 skipped`.
- `next lint`: PASS with no warnings or errors.
- Clean `NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 next build`: PASS.
- Seed and generated snapshot validation against `registry.schema.json`: PASS.
- JavaScript syntax, PowerShell parse, Bash syntax, `git diff --check`, and changed-file secret-pattern scan: PASS.

The generated probes and snapshot are ignored artifacts. Their hashes in this report are the durable binding between the exact reviewed source and the retained local evidence.

## Remaining gate

1. Independently review the exact implementation head and the hash-bound four-node snapshot.

Until that review passes, PR #532 remains draft and no placement or scheduling capability is activated. Review completion may make the registry evidence merge-ready; it does not grant AEGIS compute authority, AEGIS storage authority, or scheduler authority.
