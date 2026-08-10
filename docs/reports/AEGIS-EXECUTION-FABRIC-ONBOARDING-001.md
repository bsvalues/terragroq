# AEGIS Execution Fabric Onboarding 001

Status: `AEGIS_EXECUTION_FABRIC_ONBOARDING: COMPLETE` (scheduler remains OFF)

## Canonical role

AEGIS is the secondary CPU-batch / CI-build-test candidate node beneath Hermes. Backup-archive and NAS roles remain denied until storage is proven.

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

Disposition: healthy but occupied; storage role pending classification.

- nominal capacity: 1 TB
- SMART: PASSED
- power-on hours: 817
- reallocations: 0
- pending sectors: 0
- uncorrectables: 0
- existing NTFS partitions (~917 GB + ~13.7 GB), old Windows content unclassified

### ST31000528AS 1 TB SATA device

Disposition: present but storage role remains unproven.

- existing NTFS volume labelled `Expansion Drive`
- serial retained host-locally
- no retained SMART proof in the four-node capture
- contents and uniqueness remain unclassified

### Storage conclusion

AEGIS currently has no proven spare bulk storage across the three observed SATA devices. `backup-target`, `archive-storage`, and `nas` remain PENDING and unschedulable until storage is explicitly proven and authorized.

## Capability policy

READY candidates:
- `cpu-batch`
- `ci-build-test`
- `hash-verify`
- `compression`
- `etl`
- `docker-worker`

PENDING:
- `backup-target`
- `archive-storage`
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
- storage capabilities remain unschedulable until proven

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

Current AEGIS storage health is WARN because the failed device remains attached and the third SATA device lacks retained SMART proof; compute/runtime state is healthy.

## Privilege boundary

Passwordless `sudo` currently exists for bootstrap/operation. It is explicitly NOT a scheduler capability or authority grant.

Before autonomous privileged dispatch, replace unrestricted NOPASSWD operation with a bounded execution account and scoped sudo/service policy.

## Scheduler state

Scheduler activation remains OFF. This report provides live evidence for PR #532 and replaces the provisional `t5810-2` concept with canonical node identity `aegis` / hostname `aegis`.
