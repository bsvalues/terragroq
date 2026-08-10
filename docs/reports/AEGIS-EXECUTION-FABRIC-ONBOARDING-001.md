# AEGIS Execution Fabric Onboarding 001

Status: `AEGIS_EXECUTION_FABRIC_ONBOARDING: COMPLETE` (scheduler remains OFF)

## Canonical role

AEGIS is the secondary CPU-batch / CI-build-test candidate node beneath Hermes. Backup-target and
archive-storage capability are now restore-verified and independently freshness-gated. NAS remains
pending because no file-share service or NAS authority has been delivered.

- OMEN = cockpit / interactive development
- HERMES-NODE = AI/GPU execution
- ATLAS = authoritative durable state + Forge
- AEGIS = secondary compute; storage authority pending
- Azure = separately authorized production/external capability

## Live inventory

- Chassis: Dell Precision Tower 5810
- Hostname: `aegis`
- CPU: Intel Xeon E5-2690 v4, 1 socket, 14 cores / 28 threads, 1.2–3.5 GHz
- RAM: 16 GB ECC DDR4, 4×4 GB @ 2133 MT/s across DIMM1–DIMM4 / four channels; Micron 9ASF51272PZ family
- OS: Ubuntu 24.04.4 LTS, kernel 6.8.0-137
- NVMe: WD_BLACK SN850X 2 TB, serial retained host-locally, OS/workspace, root ext4 ~1.8 TB, SMART PASSED
- NIC: Intel I217-LM, MAC retained host-locally, 1000 Mb/s full duplex
- Docker: Engine 29.7.2, overlayfs, enabled at boot
- SSH: active
- Portainer agent: `:9001`
- Addressing: current DHCP lease `.157`; intended reservation `.158`; temporary IP is not node identity

## SATA disk findings

### Failed 4 TB-class SATA device

Disposition: `RETIRE` / not schedulable storage.

Observed inconsistent capacity reports:
- model label: 4 TB
- SMART: ~137 GB (~128 GiB)
- kernel: ~3.86 GB
- SMART health: UNKNOWN

This resolves the earlier ~3.9 GB anomaly. Treat as failing / firmware-translator capacity corruption. No storage authority is granted.

### ST1000DM003 1 TB SATA device

Disposition: `BACKUP_PRIMARY` / restore-verified.

- nominal capacity: 1 TB
- SMART: PASSED
- power-on hours: 820 in the retained v0.2 evidence
- reallocations: 0
- pending sectors: 0
- uncorrectables: 0
- ext4 label `BACKUP_PRIMARY`; UUID `0564b327-74f7-4048-9ec1-8738d09dca79`
- mounted at `/backup-primary`; approximately 867 GiB free in the retained capability snapshot

### ST31000528AS 1 TB SATA device

Disposition: `BACKUP_SECONDARY` / restore-verified second copy for crown-jewel state.

- ext4 label `BACKUP_SECONDARY`; UUID `ab119332-259b-4714-a274-8add6dbb9351`
- mounted at `/backup-secondary`; approximately 870 GiB free in the retained capability snapshot
- SMART PASSED; retained power-on hours `10474`

### Storage conclusion

AEGIS has two independently mounted 1 TB backup disks. The retained generation
`20260810T061501Z` records all protected source legs as `RESTORE_VERIFIED`, and the primary and
secondary crown-jewel manifest sets match. `backup-target` and `archive-storage` are READY only while
that evidence remains within its declared 48-hour freshness threshold. NAS remains PENDING.

## Capability policy

READY candidates:
- `cpu-batch`
- `ci-build-test`
- `hash-verify`
- `compression`
- `etl`
- `docker-worker`

READY while fresh restore evidence remains valid:
- `backup-target`
- `archive-storage`

PENDING:
- `nas`

DENY:
- authoritative WilliamOS state
- authoritative TerraFusion state
- county production writes
- PACS production writes
- implicit protected-data egress
- destructive disk actions
- implicit GPU capability

Constraints:
- 16 GB RAM; reject memory-heavy jobs without sufficient headroom
- protect NVMe OS/workspace capacity
- backup/archive execution authority remains ungranted even while capability health is READY
- NAS remains unschedulable until both its service and authority are separately proven

## Health integration

AEGIS health evidence reports:
- online
- CPU load
- RAM
- NVMe free
- Docker
- Portainer agent
- NIC/link
- disk SMART state

The retained producer snapshot separates node and capability health. The reviewed registry assembly
then applies its own raw-node freshness gate:

- node health: `WARN` only because Linux reports an absent/phantom zero-byte bay;
- producer compute capability: `READY`;
- registry compute projection: `DEGRADED / LIVE_PROBE_STALE` because the independently retained raw
  node probe predates the capability snapshot by more than the five-minute compute window;
- backup capability: `READY`;
- archive capability: `READY`;
- NAS capability: `PENDING`.

A backup evidence failure does not erase compute readiness. Missing, malformed, stale, mismatched,
or incomplete restore evidence fails only backup/archive capability closed.

## Privilege boundary

Passwordless `sudo` currently exists for bootstrap/operation. It is explicitly NOT a scheduler capability or authority grant.

Before autonomous privileged dispatch, replace unrestricted NOPASSWD operation with a bounded execution account and scoped sudo/service policy. Capability readiness is not that authority grant.

## Scheduler state

Scheduler activation remains OFF. The v0.2 capability refresh does not grant backup, archive,
compute, NAS, privileged, or autonomous execution authority.

## Retained v0.2 evidence

- capability schema: `aegis-capability/1`
- capability observed at: `2026-08-10T06:59:09Z`
- capability self-digest: `77fc4cbc56702ea60a56c361e974e19f617d1845d03bbfb9c3bbb4c453fadfdd`
- retained capability file SHA-256: `7F08C56825F786A9905F35630A387007A5868328E2FF07E024674C7D0C31FC8F`
- canonical backup receipt SHA-256: `FB766CA0F3428F20CCDC980CA0CA140062DCD5DBCE112AD25AC14B6286A5D5B9`
- retained evidence-contract SHA-256: `966F28C401461E28867375D07CB3BFA434F39A76202BFED77B1F906823263F55`
- scheduler field: `OFF`
- current trust caveat: the proven backup trust paths still land as broad `bs`; this is not accepted
  as a privileged scheduling identity.
