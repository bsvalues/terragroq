import fs from "node:fs"
import { workerData } from "node:worker_threads"

import {
  atomicPersistSchedulerLockOwner,
  schedulerLockFence,
  schedulerLockOwnerRecord,
} from "./scheduler-lock-lease.mjs"

const { ownerPath, owner, leaseDurationMs, heartbeatIntervalMs, controlBuffer } = workerData
const control = new Int32Array(controlBuffer)

try {
  const renew = () => {
    const current = JSON.parse(fs.readFileSync(ownerPath, "utf8"))
    if (current.statePath !== owner.statePath || current.pid !== owner.pid || current.hostname !== owner.hostname
      || current.nonce !== owner.nonce || current.generation !== Atomics.load(control, 2)
      || current.lockFence !== schedulerLockFence(current)) {
      throw new Error("SCHEDULER_LOCK_LEASE_LOST")
    }
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

  renew()
  Atomics.store(control, 1, 1)
  Atomics.notify(control, 1)
  for (;;) {
    Atomics.wait(control, 0, 0, heartbeatIntervalMs)
    if (Atomics.load(control, 0) !== 0) break
    renew()
  }
} catch {
  Atomics.store(control, 4, 1)
} finally {
  if (Atomics.load(control, 1) === 0) {
    Atomics.store(control, 1, 1)
    Atomics.notify(control, 1)
  }
  Atomics.store(control, 3, 1)
  Atomics.notify(control, 3)
}
