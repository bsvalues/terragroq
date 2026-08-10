# WilliamOS Execution Fabric v0.2 capability matrix

Issue: `#536`

Status: `CAPABILITY_EVIDENCE_READY / SCHEDULER_OFF / EXECUTION_AUTHORITY_NOT_GRANTED`

## Result

Execution Fabric capability health is now distinct from node health and from execution authority.
The AEGIS producer emits one self-digest-bound `aegis-capability/1` snapshot. Registry assembly may
promote `backup-target` and `archive-storage` only when that exact snapshot is well formed, current,
reports `RESTORE_VERIFIED` evidence through its producer contract, and retains `scheduler=OFF`.

## AEGIS capability truth

| Axis | State | Evidence |
| --- | --- | --- |
| node | `WARN` | Phantom zero-byte bay; no capacity claim |
| compute | `DEGRADED / LIVE_PROBE_STALE` | Producer reports READY, but the independent raw node probe is outside the five-minute compute window |
| backup-target | `READY` while fresh | Restore-verified generation `20260810T061501Z`, 48-hour threshold |
| archive-storage | `READY` while fresh | Same restore-verified evidence contract as backup v1 |
| NAS | `PENDING` | No file-share service or NAS authority |

Missing, malformed, hash-mismatched, future-dated, stale, or scheduler-enabled capability evidence
fails backup and archive closed. Backup failure does not make the node or compute capability fail.

## Evidence binding

- producer schema: `aegis-capability/1`
- canonicalization: `jcs-rfc8785/1`
- node: `aegis`
- observed at: `2026-08-10T06:59:09Z`
- self-digest: `77fc4cbc56702ea60a56c361e974e19f617d1845d03bbfb9c3bbb4c453fadfdd`
- retained capability file SHA-256: `7F08C56825F786A9905F35630A387007A5868328E2FF07E024674C7D0C31FC8F`
- retained evidence-contract SHA-256: `966F28C401461E28867375D07CB3BFA434F39A76202BFED77B1F906823263F55`
- reviewed assembly time: `2026-08-10T06:59:09Z`
- reviewed assembled snapshot SHA-256: `1ED2A12B5A407C13248F66F514469E3F4B06DD0C8DE77C22A22C90AD646AF660`
- backup/archive expiry: `2026-08-12T06:15:01Z`
- compute projection: `DEGRADED / LIVE_PROBE_STALE`

Raw evidence remains host-local and ignored. These digests bind the reviewed repository conclusion
to the retained producer artifacts without publishing machine inventory or credentials.

The assembled snapshot is a retained capability-promotion proof, not a current placement input. Its
older raw machine probes are intentionally stale and therefore cannot authorize or support dispatch.

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
