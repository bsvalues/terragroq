# WO-AEH-026 — dynamic resource admission simulation substage

Result: repository simulation complete; live metrics, reservation, and dispatch dependencies remain incomplete and R3-blocked.

Assurance remediation upgraded the contract to v2. Evaluation time now comes from a trusted caller clock, never from a producer-controlled `now`. Telemetry binds UUID boot, monotonic sequence, snapshot and collector receipt identities/digests, synchronization state, and maximum clock error; caller replay state rejects cross-boot and repeated/out-of-order sequences. The canonical job cost evidence binds WO021 job/attempt/lease/fence and authority/capability identity, input/config/image/model/template/toolchain/profile digests, and every cost field.

Capacity uses checked complete working sets: disk is input + transfer + staging + output + scratch, RAM is declared RAM + input + output, and Hermes receives the same RAM/disk gates plus VRAM. CPU/GPU milliseconds are bounded by signed lease duration and policy runtime maximum. A passing estimate is explicitly classified `STALE_RACE_ATOMIC_RESERVATION_REQUIRED`, because only a later atomic reservation can turn fresh telemetry into dispatch-safe capacity.

The pure admission evaluator consumes a closed Ed25519-signed envelope containing a digest-bound job cost envelope, identity-bound fresh telemetry, and a digest-bound reserve policy. It supports only the currently validated AEGIS HASH_VERIFY/BUILD/TEST and Hermes INFERENCE placements. All quantities are nonnegative safe integers with explicit byte, millisecond, milli-load, and milli-Celsius field names. Unknown, missing, unsafe, stale, expired, future, identity-mismatched, digest-mismatched, signature-invalid, or target/operation-ambiguous input fails before capacity evaluation.

Hard gates cover transfer bytes; CPU/GPU temperature; CPU load and memory pressure; queue depth and active leases; Atlas protected RAM and disk reserves; AEGIS job RAM, scratch, and protected reserves; and Hermes job VRAM plus protected GPU reserve. Reserve arithmetic is subtraction-ordered to avoid overflow. Reason codes are closed and sorted.

Even a passing result is `ADMIT_SIMULATION`: `recommendationOnly=true`, `dispatchAllowed=false`, and `reservationCreated=false`. The decision binds the input, telemetry measurement, policy, and decision digests. Concurrent evaluations of the same snapshot can both recommend admission but cannot reserve capacity or authorize work.

Nine native behavioral/property tests passed twice. They cover exact threshold ±1 behavior, independent protected reserves, thermal/load/pressure/queue/lease/transfer saturation, stale/future/expired/missing/tampered inputs, unsafe arithmetic, monotonic free-resource improvement, concurrent same-snapshot estimates, deterministic receipts, and rejection of historical preflight evidence.

No live telemetry, node, database, queue, lease, reservation, worker, network, service, credential, dispatch, or host state was read or changed. Repository fixtures do not prove metric collection, atomic reservation, scheduling, live capacity, placement safety, or production readiness. Live dependencies remain incomplete.

Rollback removes only the evaluator, native test, report, and evidence file.
