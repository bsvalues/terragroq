import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createSingleShotDispatchStore } from "../scripts/execution-fabric/runtime/single-shot-dispatch-store.mjs"

const dirs: string[] = []
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-single-shot-"))
  dirs.push(directory)
  const statePath = path.join(directory, "state.json")
  let now = Date.parse("2026-08-10T17:00:00.000Z")
  const store = createSingleShotDispatchStore(statePath, { clock: () => now })
  const admission = {
    dispatch_id: "DISPATCH-EF-001",
    work_order_id: "WO-EF-DISPATCH-001",
    authority_reference: "issue-538-phase3-dispatch-001",
    admission_sha256: sha("admission"),
    template_id: "hermes-loopback-local-inference-v1",
    template_sha256: sha("template"),
    selected_node_id: "hermes-node",
  }
  return { store, statePath, admission, advance: (milliseconds: number) => { now += milliseconds } }
}

afterEach(() => dirs.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })))

describe("Execution Fabric single-shot dispatch store", () => {
  it("persists one admitted request, consumes one call, and replays completion idempotently", () => {
    const { store, statePath, admission } = fixture()
    store.admit(admission)
    const lease = store.acquire({
      dispatchId: admission.dispatch_id,
      holderId: "resident-hermes",
      holderTokenDigest: sha("holder"),
      leaseDurationMs: 60_000,
    })
    const started = store.markRequestStarted({
      dispatchId: admission.dispatch_id,
      holderId: "resident-hermes",
      fencingToken: lease.fencing_token,
      requestSha256: sha("request"),
    })
    expect(started).toMatchObject({ state: "REQUEST_STARTED", request_started: true })
    const completed = store.complete({
      dispatchId: admission.dispatch_id,
      holderId: "resident-hermes",
      fencingToken: lease.fencing_token,
      responseSha256: sha("response"),
      receipt: { result: "PASS" },
    })
    expect(completed).toMatchObject({ state: "COMPLETE", response_sha256: sha("response") })
    expect(store.complete({
      dispatchId: admission.dispatch_id,
      holderId: "resident-hermes",
      fencingToken: lease.fencing_token,
      responseSha256: sha("different"),
      receipt: { result: "OTHER" },
    })).toMatchObject({ state: "COMPLETE", response_sha256: sha("response") })
    expect(store.read().dispatches[admission.dispatch_id].events.map((event: any) => event.event))
      .toEqual(["ADMITTED", "LEASE_ACQUIRED", "REQUEST_STARTED", "COMPLETE"])
  })

  it("allows only one holder and fences a reclaimed stale writer", () => {
    const { store, admission, advance } = fixture()
    store.admit(admission)
    const first = store.acquire({ dispatchId: admission.dispatch_id, holderId: "one", holderTokenDigest: sha("one"), leaseDurationMs: 100 })
    expect(() => store.acquire({ dispatchId: admission.dispatch_id, holderId: "two", holderTokenDigest: sha("two"), leaseDurationMs: 100 }))
      .toThrowError(expect.objectContaining({ code: "DISPATCH_ALREADY_LEASED" }))
    advance(101)
    const second = store.recoverExpired({
      dispatchId: admission.dispatch_id,
      holderId: "two",
      holderTokenDigest: sha("two"),
      expectedFencingToken: first.fencing_token,
      leaseDurationMs: 100,
    })
    expect(second.fencing_token).toBeGreaterThan(first.fencing_token)
    expect(() => store.markRequestStarted({
      dispatchId: admission.dispatch_id,
      holderId: "one",
      fencingToken: first.fencing_token,
      requestSha256: sha("request"),
    })).toThrowError(expect.objectContaining({ code: "FENCING_TOKEN_CONFLICT" }))
  })

  it("never retries after request initiation if the lease expires", () => {
    const { store, admission, advance } = fixture()
    store.admit(admission)
    const first = store.acquire({ dispatchId: admission.dispatch_id, holderId: "one", holderTokenDigest: sha("one"), leaseDurationMs: 100 })
    store.markRequestStarted({ dispatchId: admission.dispatch_id, holderId: "one", fencingToken: first.fencing_token, requestSha256: sha("request") })
    advance(101)
    const recovered = store.recoverExpired({
      dispatchId: admission.dispatch_id,
      holderId: "two",
      holderTokenDigest: sha("two"),
      expectedFencingToken: first.fencing_token,
      leaseDurationMs: 100,
    })
    expect(recovered).toMatchObject({ state: "OUTCOME_UNKNOWN_DO_NOT_REPLAY", request_started: true })
    expect(() => store.acquire({ dispatchId: admission.dispatch_id, holderId: "three", holderTokenDigest: sha("three"), leaseDurationMs: 100 }))
      .not.toThrow()
    expect(store.read().dispatches[admission.dispatch_id].state).toBe("OUTCOME_UNKNOWN_DO_NOT_REPLAY")
  })

  it("rejects admission collisions and corrupted evidence chains", () => {
    const { store, statePath, admission } = fixture()
    store.admit(admission)
    expect(() => store.admit({ ...admission, admission_sha256: sha("other") }))
      .toThrowError(expect.objectContaining({ code: "DISPATCH_IDEMPOTENCY_CONFLICT" }))
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"))
    state.dispatches[admission.dispatch_id].events[0].payload_sha256 = sha("corrupt")
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8")
    expect(() => store.read()).toThrowError(expect.objectContaining({ code: "DISPATCH_STATE_CORRUPT" }))
  })

  it("fails closed on an active lock and atomically recovers a stale crash lock", () => {
    const { statePath, admission, advance } = fixture()
    const lockPath = `${statePath}.lock`
    fs.writeFileSync(lockPath, `${JSON.stringify({
      acquired_at: "2026-08-10T17:00:00.000Z",
      owner_pid: 999999,
      token: "crashed-holder",
    })}\n`, "utf8")
    const activeStore = createSingleShotDispatchStore(statePath, {
      clock: () => Date.parse("2026-08-10T17:02:59.999Z"),
      staleLockMs: 180_000,
    })
    expect(() => activeStore.admit(admission))
      .toThrowError(expect.objectContaining({ code: "DISPATCH_STATE_BUSY" }))

    advance(180_001)
    const recoveredStore = createSingleShotDispatchStore(statePath, {
      clock: () => Date.parse("2026-08-10T17:03:00.001Z"),
      staleLockMs: 180_000,
    })
    expect(recoveredStore.admit(admission)).toMatchObject({ state: "ADMITTED" })
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(fs.readdirSync(path.dirname(statePath)).some((name) => name.includes(".stale-"))).toBe(false)
  })
})
