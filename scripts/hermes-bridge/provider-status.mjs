/**
 * Lane availability status, written by the hermes-bridge dispatch path.
 *
 * `scripts/runtime-operator/worker-lanes.mjs` already states the policy: "provider exhaustion
 * reroutes when another approved lane can satisfy the work order -- parking as a typed timed wait
 * only when nothing capable remains". `selectLane` implements it by skipping any lane whose
 * persisted `unavailableUntil` is still in the future -- but it can only skip what someone recorded.
 * The runtime-operator adapter records its own rate limits; the hermes-bridge dispatch path never
 * did, so the shared status file went stale and the exhaustion the bridge observed was invisible to
 * lane policy. This module is that missing write.
 *
 * Everything here fails SOFT. A status file that cannot be read or written is a lost optimisation,
 * never a lost dispatch: the caller keeps its existing defer behaviour either way. Nothing from the
 * provider's message is persisted -- only the lane id, the parsed instant, and a typed reason.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** The lane the hermes-bridge App Server dispatch actually consumes. */
export const HERMES_DISPATCH_LANE = "codex"

/** Typed reason recorded when a lane declares its own usage/credit exhaustion. */
export const USAGE_LIMIT_EXHAUSTION_REASON = "USAGE_LIMIT_EXCEEDED"

/**
 * Where the runtime operator keeps lane availability.
 *
 * Mirrors `operational-kernel-cli.mjs`'s `--root` default so both writers and `selectLane`'s reader
 * agree on one file; callers may override the whole path for tests or a relocated root.
 *
 * @param {any} options
 */
export function resolveProviderStatusPath({ root = null, homedir = os.homedir() } = {}) {
  return path.join(
    root ?? path.join(homedir, ".williamos", "runtime-operator"),
    "state",
    "provider-status.json",
  )
}

/**
 * Read the persisted lane status, or an empty status when it is missing, unreadable, or not an
 * object. An unusable status file must never be mistaken for "every lane is available forever" in a
 * way that throws -- it simply carries no availability claims.
 *
 * @param {any} options
 */
export function readProviderStatus({
  statusPath = resolveProviderStatusPath(),
  fileSystem = fs,
} = {}) {
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(statusPath, "utf8"))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Record that one lane is exhausted until a stated instant.
 *
 * The existing document is merged, not replaced: `lastDispatch` and every other lane's record
 * survive, because this writer knows about exactly one lane and must not speak for the rest. The
 * write is atomic (temp file + rename) so a concurrent reader sees either the old document or the
 * new one, never a half-written one.
 *
 * Returns `{ persisted, status }` — `status` is the intended document even when the write failed,
 * so a caller can still consult lane policy against what it just observed.
 *
 * @param {any} options
 */
export function recordLaneExhaustion({
  laneId = HERMES_DISPATCH_LANE,
  unavailableUntil,
  reason = USAGE_LIMIT_EXHAUSTION_REASON,
  statusPath = resolveProviderStatusPath(),
  fileSystem = fs,
} = {}) {
  const parsedUntil = typeof unavailableUntil === "string" ? Date.parse(unavailableUntil) : Number.NaN
  if (typeof laneId !== "string" || laneId.trim() === "" || !Number.isFinite(parsedUntil)) {
    return {
      persisted: false,
      outcome: "INVALID_LANE_EXHAUSTION",
      status: readProviderStatus({ statusPath, fileSystem }),
    }
  }
  const status = readProviderStatus({ statusPath, fileSystem })
  const next = {
    ...status,
    [laneId]: { unavailableUntil: new Date(parsedUntil).toISOString(), reason },
  }
  const temporaryPath = `${statusPath}.${process.pid}.${Date.now().toString(36)}.tmp`
  try {
    fileSystem.mkdirSync(path.dirname(statusPath), { recursive: true })
    fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
    fileSystem.renameSync(temporaryPath, statusPath)
    return { persisted: true, outcome: "LANE_EXHAUSTION_RECORDED", status: next }
  } catch {
    try { fileSystem.rmSync(temporaryPath, { force: true }) } catch {}
    return { persisted: false, outcome: "LANE_EXHAUSTION_WRITE_FAILED", status: next }
  }
}
