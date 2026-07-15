import fs from "node:fs"
import { workerData } from "node:worker_threads"

import {
  atomicPersistSchedulerLockOwner,
  schedulerLockOwnerRecord,
} from "./scheduler-lock-lease.mjs"

const { ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, controlBuffer } = workerData
const control = new Int32Array(controlBuffer)

Atomics.store(control, 1, 1)
Atomics.notify(control, 1)

try {
  for (;;) {
    Atomics.wait(control, 0, 0, heartbeatIntervalMs)
    if (Atomics.load(control, 0) !== 0) break
    const current = JSON.parse(fs.readFileSync(ownerPath, "utf8"))
    if (current.nonce !== owner.nonce || current.generation !== Atomics.load(control, 2)) break
    const now = Date.now()
    const renewed = schedulerLockOwnerRecord({
      statePath: owner.statePath,
      pid: owner.pid,
      hostname: owner.hostname,
      nonce: owner.nonce,
      generation: current.generation + 1,
      issuedAt: owner.issuedAt,
      heartbeatAt: now,
      expiresAt: now + leaseDurationMs,
    })
    atomicPersistSchedulerLockOwner(ownerPath, renewed)
    Atomics.store(control, 2, renewed.generation)
  }
} catch {
  Atomics.store(control, 4, 1)
} finally {
  Atomics.store(control, 3, 1)
  Atomics.notify(control, 3)
}
