import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { inspectLaneLeaseStore } from "./lane-lease-checkpoint.mjs"
import { inspectReservationLedger } from "./reservation-ledger.mjs"

function hostWall(detail) {
  const error = new Error(`HANDOFF_LIVE_BINDING_WALL:${detail}`)
  error.code = "HANDOFF_LIVE_BINDING_WALL"
  throw error
}

function canonical(value) {
  return path.resolve(value)
}

function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function nearestExistingRealPath(candidate) {
  let current = candidate
  for (;;) {
    try { return fs.realpathSync.native(current) } catch (error) {
      if (error?.code !== "ENOENT") hostWall("STATE_PATH_INSPECTION_FAILED")
      const parent = path.dirname(current)
      if (parent === current) hostWall("STATE_PATH_INSPECTION_FAILED")
      current = parent
    }
  }
}

function git(workspacePath, args) {
  try {
    return execFileSync("git", ["-C", workspacePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    hostWall("GIT_INSPECTION_FAILED")
  }
}

function githubRepository(remote) {
  let repository = null
  try {
    const parsed = new URL(remote)
    if (parsed.hostname.toLowerCase() !== "github.com") return null
    repository = parsed.pathname.replace(/^\/+|\/+$/g, "")
  } catch {
    const scp = remote.match(/^(?:[^@/:]+@)?github\.com:([^\s]+)$/i)
    repository = scp?.[1] ?? null
  }
  if (repository === null) return null
  const normalized = repository.replace(/\.git$/i, "")
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null
}

function authorizeStorePath(stateRoot, requestedStorePath) {
  const storePath = canonical(requestedStorePath)
  const storeParent = nearestExistingRealPath(path.dirname(storePath))
  if (!within(stateRoot, storeParent)) hostWall("STORE_PATH_OUTSIDE_APPROVED_ROOT")
  try {
    const stats = fs.lstatSync(storePath)
    if (stats.isSymbolicLink() || !within(stateRoot, fs.realpathSync.native(storePath))) {
      hostWall("STORE_PATH_OUTSIDE_APPROVED_ROOT")
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  return { authorized: true, canonicalStorePath: storePath }
}

export function createReservationAwareHandoffHostVerifier({
  approvedStateRoot,
  reservationLedgerPath,
  reservationLedgerId,
  laneLeaseStorePath,
  laneLeaseStoreId,
  now = () => Date.now(),
}) {
  const stateRoot = fs.realpathSync.native(canonical(approvedStateRoot))
  return Object.freeze({
    authorizeStorePath(storePath) {
      return authorizeStorePath(stateRoot, storePath)
    },
    verifyHandoffBinding(binding) {
      authorizeStorePath(stateRoot, binding.canonicalStorePath)

      const reservation = inspectReservationLedger(reservationLedgerPath, reservationLedgerId, {
        schemaVersion: 1,
        artifactType: "MULTI_AGENT_RESERVATION_INSPECT_REQUEST",
      })
      const liveReservation = reservation.status === "RESERVATION_LEDGER_VALID"
        ? reservation.reservations.find((entry) => entry.reservationSetId === binding.reservation.reservationSetId)
        : null
      if (!liveReservation
        || reservation.ledgerVersion !== binding.reservation.ledgerVersion
        || liveReservation.workerId !== binding.roleAssignments.builder
        || liveReservation.workOrderId !== binding.workOrderId
        || liveReservation.laneId !== binding.laneId
        || liveReservation.fencingToken !== binding.reservation.fencingToken) {
        hostWall("RESERVATION_NOT_LIVE")
      }

      const leases = inspectLaneLeaseStore(laneLeaseStorePath, laneLeaseStoreId)
      const liveLease = leases.status === "LANE_LEASE_STORE_VALID"
        ? leases.lanes.find((entry) => entry.workOrderId === binding.workOrderId && entry.laneId === binding.laneId)
        : null
      if (!liveLease || liveLease.status !== "ACTIVE"
        || Date.parse(liveLease.expiresAt) <= now()
        || liveLease.workerId !== binding.roleAssignments.builder
        || liveLease.fencingToken !== binding.lease.fencingToken
        || liveLease.checkpointSequence !== binding.lease.checkpointSequence
        || liveLease.checkpointEvidence?.headCommitSha !== binding.workspace.checkpointHeadCommitSha) {
        hostWall("LEASE_NOT_LIVE")
      }

      const workspacePath = canonical(binding.workspacePath)
      if (canonical(git(workspacePath, ["rev-parse", "--show-toplevel"])) !== workspacePath
        || git(workspacePath, ["status", "--porcelain", "--untracked-files=all"]) !== ""
        || git(workspacePath, ["rev-parse", "HEAD"]) !== binding.workspace.headCommitSha
        || git(workspacePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== binding.branch
        || githubRepository(git(workspacePath, ["remote", "get-url", "origin"])) !== binding.repository) {
        hostWall("WORKSPACE_NOT_LIVE")
      }

      return { verified: true, ...binding }
    },
  })
}
