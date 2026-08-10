# WilliamOS Execution Fabric v0.2 capability matrix

Issue: `#536`

Status: `CAPABILITY_EVIDENCE_READY / SCHEDULER_OFF / EXECUTION_AUTHORITY_NOT_GRANTED`

## Result

Execution Fabric capability health is now distinct from node health and from execution authority.
The AEGIS producer emits one self-digest-bound `aegis-capability/1` snapshot and one canonical
`aegis-backup-state/1` receipt. Registry assembly may promote `backup-target` and
`archive-storage` only when the trusted v0.2 policy pins both exact files, the fresh machine probe
matches AEGIS and both required mounts, the receipt proves independent restore-verified copies, and
the producer retains `scheduler=OFF`.

## AEGIS capability truth

| Axis | State | Evidence |
| --- | --- | --- |
| node | `WARN` | Phantom zero-byte bay; no capacity claim |
| compute | `READY` in the reviewed capture | Fresh independently captured AEGIS machine probe and active Docker runtime |
| backup-target | `READY` while fresh | Restore-verified generation `20260810T061501Z`, 48-hour threshold |
| archive-storage | `READY` while fresh | Same restore-verified evidence contract as backup v1 |
| NAS | `PENDING` | No file-share service or NAS authority |

Missing, malformed, hash-mismatched, future-dated, stale, scheduler-enabled, self-extended,
machine-identity-mismatched, or mount-incomplete evidence fails backup and archive closed. Receipt
hash/restore chronology/source-leg/manifest failures do the same. Backup failure does not make the
node or compute capability fail.

## Evidence binding

- producer schema: `aegis-capability/1`
- canonicalization: `jcs-rfc8785/1`
- node: `aegis`
- observed at: `2026-08-10T06:59:09Z`
- self-digest: `77fc4cbc56702ea60a56c361e974e19f617d1845d03bbfb9c3bbb4c453fadfdd`
- retained capability file SHA-256: `7F08C56825F786A9905F35630A387007A5868328E2FF07E024674C7D0C31FC8F`
- canonical backup receipt SHA-256: `FB766CA0F3428F20CCDC980CA0CA140062DCD5DBCE112AD25AC14B6286A5D5B9`
- retained evidence-contract SHA-256: `966F28C401461E28867375D07CB3BFA434F39A76202BFED77B1F906823263F55`
- trusted policy maximum TTL: `48 hours`
- required primary mount: `W4Y0C392 / BACKUP_PRIMARY / 0564b327-74f7-4048-9ec1-8738d09dca79 / /backup-primary`
- required secondary mount: `6VPAE286 / BACKUP_SECONDARY / ab119332-259b-4714-a274-8add6dbb9351 / /backup-secondary`
- fresh raw node probe observed at: `2026-08-10T11:22:22.198642Z`
- reviewed assembly time: `2026-08-10T11:22:33.724Z`
- reviewed assembled snapshot SHA-256: `0890E7E36900B420A78BBEB4DDB06A9725AE780414D515922F16C7BD47FDB857`
- backup/archive expiry: `2026-08-12T06:15:01Z`
- compute projection: `READY`

Raw evidence remains host-local and ignored. The reviewed policy publishes only the non-secret disk
identifiers needed to bind the two backup mounts; it does not commit the full machine inventory or
any credentials.

The assembled snapshot was fresh at its recorded assembly time. It is a retained
capability-promotion proof, not an evergreen placement input; its five-minute compute evidence and
48-hour backup/archive evidence fail closed after their recorded expiries.

## Authority boundary

```text
SCHEDULER=disabled / not-granted
AUTONOMOUS_DISPATCH=false
AEGIS_COMPUTE_EXECUTION_AUTHORITY=false
AEGIS_BACKUP_EXECUTION_AUTHORITY=false
AEGIS_ARCHIVE_EXECUTION_AUTHORITY=false
AEGIS_NAS_AUTHORITY=false
PRIVILEGED_DISPATCH=false
```

Readiness describes what the node can support. It does not authorize WilliamOS or Hermes to run it.
The existing broad `bs` privilege path remains an operational trust caveat and is not a worker grant.

## Next gate

Issue `#538` may consume this capability evidence for recommendation and shadow-placement decisions.
It may not dispatch until its own prerequisite gates and an exact bounded execution grant pass.
