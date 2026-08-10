# WilliamOS Execution Fabric v0.1 live matrix

Status: `CONTROL_SIDE_RECONCILED / LIVE_PROOF_PARTIAL / SCHEDULER_OFF`

PR: `#532`

The matrix separates declared role, retained live probe evidence, and unresolved gaps. A node is not promoted merely because a narrative report or transient observation exists.

## Node matrix

| Node | Canonical role | Evidence state | Observed capacity | Runtime/health interpretation | Placement state |
|---|---|---|---|---|---|
| OMEN | Cockpit, interactive development, burst compute | Schema-valid, machine-identity-bound probe retained locally at `2026-08-10T02:05:44.8532560Z`; SHA-256 `74C55BC07032091184FC923D19113A9AB77C6172EA3EE19BF2B2D24A05911C83`; stale under the 300-second TTL at exact-head review | Ryzen 9 8940HX, 16C/32T; 32 GiB DDR5; RTX 5060 Laptop GPU; two physical disks | WSL and SSH were observed running; Docker unavailable; Windows Storage module unavailable, so CIM disk fallback omitted partition relationships | Retained capacity evidence only; currently unschedulable due to stale evidence and no durable-state authority |
| HERMES-NODE | AI/GPU/agent execution | Transient read-only observation at `2026-08-10T01:39:03.8594782Z`; captured SHA-256 `617C9E1BD1437B63F63ADF0738FC0AF9B57F249372BC1D6D41BBEE8EA9255451`; exact bytes were not retained and recapture failed closed | Core i7-5960X, 8C/16T; 32 GiB DDR4; RTX 3050 6 GiB; three disks | Docker 28.5.1, SSH, WSL, and Ollama were observed healthy | Existing AI/GPU role retained; transient evidence is not admitted to the assembled snapshot |
| ATLAS | Authoritative DB/state, Forge, retrieval | Transient read-only observation at `2026-08-10T01:39:43.281118Z`; captured SHA-256 `88F48B5F9CCB11410AA24739BA5B4DF551C4E06C58C821B61A1CFE14E08D0CB8`; exact bytes were not retained and recapture failed closed | Xeon E5-2690 v4, 14C/28T; 32 GiB ECC DDR4; three disks; no GPU | Docker 29.7.2, SSH, and `/forge` were observed; DB service evidence was absent; `/dev/sdc` SMART fields were unknown; `/dev/sda` raw reallocation value requires interpretation | Durable-state authority retained; transient evidence is not admitted and no noisy batch promotion occurs |
| AEGIS | CPU batch, CI/build/test, hashing, compression, ETL, Docker worker | Onboarding evidence retained in `AEGIS-EXECUTION-FABRIC-ONBOARDING-001.md`; raw probe failed closed because OMEN had no pre-trusted ED25519 host key for the evidenced endpoint | Xeon E5-2690 v4, 14C/28T; 16 GiB ECC DDR4; 2 TB SN850X NVMe | The onboarding report records healthy compute/runtime observations, but they are not admitted as trusted registry evidence; ST4000DX000 is `RETIRE`; ST1000DM003 is healthy but occupied and unclassified | Compute-ready candidate only; compute placement and storage/NAS/backup remain unschedulable pending trusted proof |
| Azure | Separately authorized external envelope | Declared policy only | Unknown | No implicit provider, cost, or data authority | Non-selectable |

## Authority invariants

- Scheduler state is explicitly `disabled`; scheduler authority is `not-granted`.
- ATLAS alone retains authoritative durable-state authority.
- OMEN, HERMES-NODE, and AEGIS cannot gain durable-state authority through probe overlay.
- AEGIS's intended compute role is declared, but compute placement and storage capability remain blocked until trusted proof is admitted.
- County/PACS writes, protected-data expansion, destructive disk operations, implicit cloud use, and paid execution remain blocked.
- The failing AEGIS 4 TB disk is evidence only. No wipe or destructive action is authorized.

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

## Remaining evidence gates

1. Restore ordinary read-only reachability, then retain and schema-validate a corrected HERMES-NODE probe.
2. Restore ordinary read-only reachability, then retain and schema-validate the ATLAS probe; keep missing DB/SMART evidence explicit.
3. Establish AEGIS host trust and record its hashed machine-identity pin through the separately authorized onboarding lane, then retain a current raw probe without interfering with storage-resolution/compute-readiness work.
4. Assemble all four accepted probes into one snapshot and validate it against `registry.schema.json`.
5. Independently review the exact scripts, tests, and accepted snapshot.

Until all five gates pass, PR #532 remains draft and no placement or scheduling capability is activated.
