import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AC_CATALOG,
  evaluateAcceptance,
  parseArgs,
  probeJson,
  readExpectedInventory,
  validateEvidenceManifest,
  validateHostState,
  validateSupervisorState,
} from "@/scripts/hermes-bridge/v1-acceptance-campaign.mjs"

const now = Date.parse("2026-07-23T18:00:00.000Z")
const fresh = "2026-07-23T17:59:00.000Z"
const revision = "c".repeat(40)

function pass(detail: unknown = null) {
  return { ok: true, code: "PASS", detail }
}

function hostState() {
  return {
    schemaVersion: 1,
    storeId: "hermes-bridge",
    revision: 8,
    nextFencingToken: 3,
    updatedAt: fresh,
    killSwitch: { active: false, reason: null, updatedAt: null },
    ownerTouchCounters: {
      OWNER_OPERATION_TOUCH_COUNT: 0,
      OWNER_CREDENTIAL_TOUCH_COUNT: 0,
      OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
      OWNER_ROUTINE_DECISION_COUNT: 0,
      OWNER_ROUTINE_CONTACT_COUNT: 0,
    },
    executions: {
      "outcome-1": {
        outcomeId: "outcome-1",
        fencingToken: 2,
        lease: {
          status: "RELEASED",
          holderId: "holder-1",
          acquiredAt: "2026-07-23T17:50:00.000Z",
          expiresAt: fresh,
          releasedAt: fresh,
        },
        checkpoint: {
          sequence: 11,
          state: "COMPLETE",
          detail: null,
          recordedAt: fresh,
        },
        metadata: {},
      },
    },
    idempotency: {},
  }
}

const expectedInventory = [{
  capability: "Runtime",
  classification: "RUNTIME_PROVEN" as const,
}]

function scenarioEvidence(id: string) {
  const common = {
    "AC-01": {
      outcomeId: "8",
      workOrderRef: "WO-HERMES-OUTCOME-8",
      checkpointState: "COMPLETE",
      leaseStatus: "RELEASED",
      prNumber: 451,
      mergeSha: "a".repeat(40),
    },
    "AC-02": {
      injectedFailureId: "failure-1",
      failureClass: "VALIDATION_FAILURE",
      failureEventId: 2,
      disposition: "bounded-repair",
      recoveryState: "READY_FOR_VALIDATION",
    },
    "AC-03": {
      executionId: "execution-8",
      preRestartSequence: 3,
      postRestartSequence: 4,
      mutationCount: 1,
    },
    "AC-04": {
      workOrderRef: "WO-HERMES-OUTCOME-8",
      contenderIds: ["worker-a", "worker-b"],
      winnerId: "worker-a",
      activeWriterCount: 1,
    },
    "AC-05": {
      priorFencingToken: 4,
      nextFencingToken: 5,
      priorLeaseStatus: "ABANDONED",
      currentWriterCount: 1,
    },
    "AC-06": {
      workOrderRef: "WO-HERMES-OUTCOME-8",
      blockedAction: "production deployment",
      decision: "DENY",
      mutationCount: 0,
    },
    "AC-07": {
      attemptedPath: "outside/reservation.ts",
      reservation: "components/runtime/**",
      decision: "DENY",
      mutationCount: 0,
    },
    "AC-08": {
      executionId: "execution-8",
      interruptionKind: "TIMEOUT",
      terminalState: "FAILED_TERMINAL",
      evidencePreserved: true,
    },
    "AC-09": {
      executionId: "execution-8",
      provenanceDigest: "b".repeat(64),
      corruptionDetected: true,
      restartVerified: true,
    },
    "AC-10": {
      ownedResourceIds: ["worktree-8"],
      foreignResourceIds: ["foreign-worktree"],
      removedOwnedIds: ["worktree-8"],
      removedForeignCount: 0,
      resumed: true,
    },
    "AC-11": {
      workOrderId: 42,
      workOrderRef: "WO-HERMES-OUTCOME-8",
      workOrderViewId: 42,
      runtimeWorkOrderId: 42,
      traceWorkOrderId: 42,
      runtimeExecutionId: "work-order:42",
      checkpointEventIds: ["101"],
      leaseEventIds: ["103"],
      failureEvalEventIds: ["102"],
      evalEventIds: ["102"],
      evidenceRecordIds: ["9"],
      evidenceWorkOrderIds: [42],
      traceEventIds: ["101", "102", "103"],
      consistencyDigest: "PLACEHOLDER",
      consistent: true,
      querySource: "PERSISTED_DATABASE",
      capturedBy: "scripts/hermes-bridge/v1-product-truth-capture.mjs",
    },
    "AC-12": {
      capabilityIds: ["Runtime"],
      inventoryDigest: "c".repeat(64),
      classifications: ["RUNTIME_PROVEN", "STATIC_READ_ONLY", "EXCLUDED"],
    },
    "AC-13": {
      applicationStatus: "ok",
      workerProcessId: 123,
      workerNonce: "nonce",
      workerWorkspace: "C:\\repo",
    },
    "AC-14": {
      campaignId: "issue-448",
      ownerTouchCounters: hostState().ownerTouchCounters,
    },
  } as Record<string, Record<string, unknown>>
  if (id === "AC-11") {
    const identity = { ...common[id] }
    delete identity.consistencyDigest
    delete identity.consistent
    delete identity.querySource
    delete identity.capturedBy
    common[id].consistencyDigest = createHash("sha256")
      .update(JSON.stringify(Object.fromEntries(Object.entries(identity).sort())))
      .digest("hex")
  }
  return common[id]
}

function proofDocument(entry: (typeof AC_CATALOG)[number], kind: string) {
  return {
    schemaVersion: 1,
    issueNumber: 448,
    acceptanceCriterion: entry.id,
    kind,
    proofClass: entry.requiredProofClass,
    observedAt: fresh,
    sourceRevision: revision,
    status: "PASS",
    evidence: scenarioEvidence(entry.id),
    ...(entry.requiredProofClass === "EXECUTABLE_SCENARIO" ? {
      execution: {
        command: "vitest",
        tests: entry.tests,
        exitCode: 0,
        assertions: ["scenario contract passed"],
        runId: `run-${entry.id}`,
        startedAt: fresh,
        finishedAt: fresh,
      },
    } : {}),
  }
}

function writeProofArtifacts(root: string) {
  return Object.fromEntries(AC_CATALOG.map((entry) => [
    entry.id,
    {
      proofClass: entry.requiredProofClass,
      observedAt: fresh,
      ...(entry.requiredProofClass === "VERIFIED_STATIC" ? { revision } : {}),
      artifacts: entry.liveArtifacts.map((kind) => {
        const fileName = `${entry.id}-${kind}.json`
        const artifactPath = path.join(root, fileName)
        fs.writeFileSync(artifactPath, `${JSON.stringify(proofDocument(entry, kind))}\n`)
        fs.utimesSync(artifactPath, new Date(fresh), new Date(fresh))
        return {
          kind,
          path: fileName,
          sha256: createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex"),
          recordedAt: fresh,
        }
      }),
    },
  ]))
}

describe("WilliamOS V1 Issue #448 acceptance campaign", () => {
  it("maps AC-01 through AC-14 to executable tests and required live artifacts", () => {
    expect(AC_CATALOG.map((entry) => entry.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `AC-${String(index + 1).padStart(2, "0")}`),
    )
    for (const entry of AC_CATALOG) {
      expect(entry.tests.length).toBeGreaterThan(0)
      expect(entry.tests.every((file) => file.startsWith("tests/") && file.endsWith(".test.ts"))).toBe(true)
      expect(entry.liveArtifacts.length).toBeGreaterThan(0)
    }
    expect(AC_CATALOG.filter((entry) => entry.requiredProofClass === "LIVE").map((entry) => entry.id))
      .toEqual(["AC-01", "AC-11", "AC-13", "AC-14"])
    expect(AC_CATALOG.slice(1, 10).every(
      (entry) => entry.requiredProofClass === "EXECUTABLE_SCENARIO",
    )).toBe(true)
    expect(AC_CATALOG.find((entry) => entry.id === "AC-12")?.requiredProofClass)
      .toBe("VERIFIED_STATIC")
  })

  it("loads the complete canonical AC-12 inventory rather than a caller-selected subset", () => {
    const inventory = readExpectedInventory(process.cwd())

    expect(inventory).toHaveLength(44)
    expect(new Set(inventory.map((entry) => entry.capability)).size).toBe(44)
    expect(inventory).toContainEqual({
      capability: "hermes-worker-sidecar",
      classification: "RUNTIME_PROVEN",
    })
    expect(inventory).toContainEqual({
      capability: "local-nested-codex-adapter",
      classification: "EXCLUDED",
    })
  })

  it("evaluates endpoint freshness with a clock sampled after the response", async () => {
    const responseTimestamp = "2026-07-23T20:00:01.000Z"
    const result = await probeJson("http://localhost/api/health", {
      fetchImpl: async () => new Response(JSON.stringify({
        status: "ok",
        timestamp: responseTimestamp,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      clock: () => Date.parse("2026-07-23T20:00:02.000Z"),
      maxAgeMs: 60_000,
      timestampField: "timestamp",
    })

    expect(result.ok).toBe(true)
  })

  it("accepts a fresh schema-valid host state with zero owner counters and released terminal leases", () => {
    const result = validateHostState(hostState(), { now, maxAgeMs: 5 * 60 * 1000 })
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "PASS" }))
    expect(result.detail.leases).toEqual([
      expect.objectContaining({
        outcomeId: "outcome-1",
        fencingToken: 2,
        status: "RELEASED",
        checkpointState: "COMPLETE",
      }),
    ])
  })

  it("validates high-cardinality mutation histories without spreading an unbounded timestamp array", () => {
    const state = hostState()
    state.executions = Object.fromEntries(Array.from({ length: 50_000 }, (_, index) => {
      const outcomeId = `outcome-${index + 1}`
      const execution = structuredClone(state.executions["outcome-1"])
      execution.outcomeId = outcomeId
      execution.fencingToken = index + 1
      return [outcomeId, execution]
    }))
    state.nextFencingToken = 50_001

    expect(validateHostState(state, { now }).code).toBe("PASS")
  })

  it("accepts historical terminal state but fails closed on invalid time, owner relay, duplicate fencing, and unreleased work", () => {
    const historical = hostState()
    expect(validateHostState(historical, {
      now: Date.parse("2026-07-24T18:00:00.000Z"),
      maxAgeMs: 5 * 60 * 1000,
    }).code).toBe("PASS")

    const causalBoundary = hostState()
    Object.assign(causalBoundary.killSwitch, { updatedAt: causalBoundary.updatedAt })
    Object.assign(causalBoundary.executions["outcome-1"].lease, {
      renewedAt: causalBoundary.updatedAt,
    })
    expect(validateHostState(causalBoundary, { now }).code).toBe("PASS")

    const causalMutations = [
      ["killSwitch.updatedAt", (state: ReturnType<typeof hostState>) => {
        state.killSwitch.updatedAt = fresh
      }],
      ["checkpoint.recordedAt", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].checkpoint.recordedAt = fresh
      }],
      ["lease.acquiredAt", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].lease.acquiredAt = fresh
      }],
      ["lease.renewedAt", (state: ReturnType<typeof hostState>) => {
        Object.assign(state.executions["outcome-1"].lease, { renewedAt: fresh })
      }],
      ["lease.releasedAt", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].lease.releasedAt = fresh
      }],
      ["lease.abandonedAt", (state: ReturnType<typeof hostState>) => {
        Object.assign(state.executions["outcome-1"].lease, { abandonedAt: fresh })
      }],
      ["lease.recoveredAt", (state: ReturnType<typeof hostState>) => {
        Object.assign(state.executions["outcome-1"].lease, { recoveredAt: fresh })
      }],
      ["lease.deferredAt", (state: ReturnType<typeof hostState>) => {
        Object.assign(state.executions["outcome-1"].lease, { deferredAt: fresh })
      }],
      ["released lease.expiresAt", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].lease.expiresAt = fresh
      }],
      ["abandoned lease.expiresAt", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].checkpoint.state = "REVIEW_PENDING"
        state.executions["outcome-1"].lease.status = "ABANDONED"
        state.executions["outcome-1"].lease.expiresAt = fresh
        Object.assign(state.executions["outcome-1"].lease, {
          recoveredAt: "2026-07-23T17:58:00.000Z",
        })
      }],
      ["multiple nested timestamps", (state: ReturnType<typeof hostState>) => {
        state.executions["outcome-1"].checkpoint.recordedAt = "2026-07-23T17:59:30.000Z"
        state.executions["outcome-1"].lease.acquiredAt = "2026-07-23T17:59:15.000Z"
        Object.assign(state.executions["outcome-1"].lease, { renewedAt: fresh })
      }],
    ] as const
    for (const [field, mutate] of causalMutations) {
      const causallyInvalid = hostState()
      causallyInvalid.updatedAt = "2026-07-23T17:58:59.999Z"
      causallyInvalid.executions["outcome-1"].checkpoint.recordedAt = "2026-07-23T17:58:00.000Z"
      causallyInvalid.executions["outcome-1"].lease.acquiredAt = "2026-07-23T17:58:00.000Z"
      causallyInvalid.executions["outcome-1"].lease.releasedAt = "2026-07-23T17:58:00.000Z"
      mutate(causallyInvalid)
      expect(validateHostState(causallyInvalid, { now }).code, field)
        .toBe("HOST_STATE_CAUSALITY_INVALID")
    }

    const invalidLeaseMutation = hostState()
    Object.assign(invalidLeaseMutation.executions["outcome-1"].lease, { renewedAt: "not-a-timestamp" })
    expect(validateHostState(invalidLeaseMutation, { now }).code).toBe("LEASE_MUTATION_TIMESTAMP_INVALID")

    const futureLeaseMutation = hostState()
    Object.assign(futureLeaseMutation.executions["outcome-1"].lease, {
      renewedAt: "2026-07-23T18:00:01.000Z",
    })
    expect(validateHostState(futureLeaseMutation, { now }).code).toBe("LEASE_MUTATION_TIMESTAMP_INVALID")

    const futureExpiry = hostState()
    futureExpiry.executions["outcome-1"].checkpoint.state = "REVIEW_PENDING"
    futureExpiry.executions["outcome-1"].lease.status = "ACTIVE"
    futureExpiry.executions["outcome-1"].lease.expiresAt = "2026-07-23T18:05:00.000Z"
    expect(validateHostState(futureExpiry, { now }).code).toBe("PASS")

    const future = hostState()
    future.updatedAt = "2026-07-23T18:00:01.000Z"
    expect(validateHostState(future, { now }).code).toBe("HOST_STATE_TIMESTAMP_INVALID")

    const malformed = hostState()
    malformed.updatedAt = "not-a-timestamp"
    expect(validateHostState(malformed, { now }).code).toBe("HOST_STATE_TIMESTAMP_INVALID")

    const staleNonterminal = hostState()
    staleNonterminal.updatedAt = "2026-07-01T16:00:00.000Z"
    staleNonterminal.executions["outcome-1"].checkpoint.state = "REVIEW_PENDING"
    staleNonterminal.executions["outcome-1"].checkpoint.recordedAt = staleNonterminal.updatedAt
    staleNonterminal.executions["outcome-1"].lease.acquiredAt = staleNonterminal.updatedAt
    staleNonterminal.executions["outcome-1"].lease.expiresAt = staleNonterminal.updatedAt
    staleNonterminal.executions["outcome-1"].lease.releasedAt = staleNonterminal.updatedAt
    expect(validateHostState(staleNonterminal, { now, maxAgeMs: 5 * 60 * 1000 }).code).toBe("HOST_STATE_STALE")

    const futureCheckpoint = hostState()
    futureCheckpoint.executions["outcome-1"].checkpoint.recordedAt = "2026-07-23T18:00:01.000Z"
    expect(validateHostState(futureCheckpoint, { now }).code).toBe("LEASE_OR_CHECKPOINT_SCHEMA_INVALID")

    const futureRelease = hostState()
    futureRelease.executions["outcome-1"].lease.releasedAt = "2026-07-23T18:00:01.000Z"
    expect(validateHostState(futureRelease, { now }).code).toBe("RELEASED_LEASE_SCHEMA_INVALID")

    const touched = hostState()
    touched.ownerTouchCounters.OWNER_ROUTINE_CONTACT_COUNT = 1
    expect(validateHostState(touched, { now }).code).toBe("FAIL_OWNER_BABYSITTING")

    const duplicate = hostState()
    duplicate.executions["outcome-2"] = {
      ...duplicate.executions["outcome-1"],
      outcomeId: "outcome-2",
    }
    expect(validateHostState(duplicate, { now }).code).toBe("LEASE_OR_CHECKPOINT_SCHEMA_INVALID")

    const leased = hostState()
    leased.executions["outcome-1"].lease.status = "ACTIVE"
    leased.executions["outcome-1"].lease.expiresAt = "2026-07-23T18:05:00.000Z"
    expect(validateHostState(leased, { now }).code).toBe("TERMINAL_LEASE_NOT_RELEASED")
  })

  it("validates the resident supervisor independently from application health", () => {
    const workspace = path.resolve("repo")
    const supervisorPath = path.join(workspace, "scripts", "hermes-bridge", "supervisor.ps1")
    const state = {
      schemaVersion: 1,
      processId: 123,
      nonce: "nonce",
      workspace,
      supervisorPath,
      hostMode: "INTERACTIVE_USER_RESIDENT",
      startedAt: fresh,
    }
    const posture = {
      now,
      expectedWorkspace: workspace,
      expectedSupervisorPath: supervisorPath,
    }
    let probedState: typeof state | null = null
    expect(validateSupervisorState(state, {
      ...posture,
      processProbe: (candidate) => {
        probedState = candidate
        return candidate.nonce === "nonce"
      },
    }).ok).toBe(true)
    expect(probedState).toBe(state)
    expect(validateSupervisorState(state, { ...posture, processProbe: () => false }).code).toBe(
      "SUPERVISOR_PROCESS_NOT_LIVE",
    )
    state.startedAt = "2026-07-20T17:59:00.000Z"
    expect(validateSupervisorState(state, { ...posture, processProbe: () => true }).ok).toBe(true)
    expect(validateSupervisorState(state, {
      ...posture,
      expectedWorkspace: path.resolve("other"),
      processProbe: () => true,
    }).code).toBe("SUPERVISOR_POSTURE_MISMATCH")
  })

  it("verifies typed fresh artifacts and file digests instead of trusting manifest labels", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-acceptance-"))
    const scenarios = writeProofArtifacts(root)
    const manifest = {
      schemaVersion: 1,
      issueNumber: 448,
      observedAt: fresh,
      scenarios,
      inventory: [{
        capability: "Runtime",
        classification: "RUNTIME_PROVEN",
        revision,
        evidence: ["AC-12-v1-inventory.json"],
      }],
      githubPullRequests: [{
        repo: "bsvalues/terragroq",
        number: 449,
        headSha: "a".repeat(40),
        mergeSha: "b".repeat(40),
      }],
    }
    const result = validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      maxAgeMs: 5 * 60 * 1000,
      expectedInventory,
    })
    expect(result.ok).toBe(true)

    const artifactPath = path.join(root, scenarios["AC-01"].artifacts[0].path)
    fs.utimesSync(
      artifactPath,
      new Date("2026-07-23T16:00:00.000Z"),
      new Date("2026-07-23T16:00:00.000Z"),
    )
    expect(validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      expectedInventory,
    }).code).toBe("LIVE_ARTIFACT_FILE_STALE")

    fs.utimesSync(artifactPath, new Date(fresh), new Date(fresh))
    scenarios["AC-09"].artifacts[0].sha256 = "0".repeat(64)
    expect(validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      expectedInventory,
    }).code).toBe("LIVE_ARTIFACT_MISSING_OR_DIGEST_MISMATCH")
  })

  it("rejects AC-11 artifacts with empty persisted Evidence relations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-empty-evidence-"))
    const scenarios = writeProofArtifacts(root)
    const manifest = {
      schemaVersion: 1,
      issueNumber: 448,
      observedAt: fresh,
      scenarios,
      inventory: [{
        capability: "Runtime",
        classification: "RUNTIME_PROVEN",
        revision,
        evidence: ["AC-12-v1-inventory.json"],
      }],
      githubPullRequests: [{
        repo: "bsvalues/terragroq",
        number: 449,
        headSha: "a".repeat(40),
        mergeSha: "b".repeat(40),
      }],
    }
    const artifact = scenarios["AC-11"].artifacts[0]
    const artifactPath = path.join(root, artifact.path)
    const document = JSON.parse(fs.readFileSync(artifactPath, "utf8"))
    document.evidence.evidenceRecordIds = []
    document.evidence.evidenceWorkOrderIds = []
    const identity = { ...document.evidence }
    delete identity.consistencyDigest
    delete identity.consistent
    delete identity.querySource
    delete identity.capturedBy
    document.evidence.consistencyDigest = createHash("sha256")
      .update(JSON.stringify(Object.fromEntries(Object.entries(identity).sort())))
      .digest("hex")
    fs.writeFileSync(artifactPath, `${JSON.stringify(document)}\n`)
    fs.utimesSync(artifactPath, new Date(fresh), new Date(fresh))
    artifact.sha256 = createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex")

    expect(validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      maxAgeMs: 5 * 60 * 1000,
      expectedInventory,
    }).code).toBe("PROOF_ARTIFACT_CONTRACT_INVALID")
  })

  it("rejects LIVE claims for executable scenarios and stale revision inventory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-proof-class-"))
    const scenarios = writeProofArtifacts(root)
    const manifest = {
      schemaVersion: 1,
      issueNumber: 448,
      observedAt: fresh,
      scenarios,
      inventory: [{
        capability: "Runtime",
        classification: "RUNTIME_PROVEN",
        revision,
        evidence: ["proof.json"],
      }],
      githubPullRequests: [{
        repo: "bsvalues/terragroq",
        number: 449,
        headSha: "a".repeat(40),
        mergeSha: "b".repeat(40),
      }],
    }

    scenarios["AC-02"].proofClass = "LIVE"
    expect(validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      expectedInventory,
    }).code).toBe("SCENARIO_PROOF_CLASS_OR_FRESHNESS_INVALID")

    scenarios["AC-02"].proofClass = "EXECUTABLE_SCENARIO"
    manifest.inventory[0].revision = "d".repeat(40)
    expect(validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      expectedInventory,
    }).code).toBe("V1_INVENTORY_INVALID")
  })

  it("rejects arbitrary proof contents, evidence-root escapes, repository escapes, and incomplete inventory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-proof-scope-"))
    const scenarios = writeProofArtifacts(root)
    const manifest = {
      schemaVersion: 1,
      issueNumber: 448,
      observedAt: fresh,
      scenarios,
      inventory: [{
        capability: "Runtime",
        classification: "RUNTIME_PROVEN",
        revision,
        evidence: ["AC-12-v1-inventory.json"],
      }],
      githubPullRequests: [{
        repo: "bsvalues/terragroq",
        number: 449,
        headSha: "a".repeat(40),
        mergeSha: "b".repeat(40),
      }],
    }
    const validate = () => validateEvidenceManifest(manifest, {
      manifestPath: path.join(root, "manifest.json"),
      currentRevision: revision,
      now,
      expectedInventory,
    })

    const ac01Artifact = scenarios["AC-01"].artifacts[0]
    const ac01Path = path.join(root, ac01Artifact.path)
    fs.writeFileSync(ac01Path, "{}\n")
    fs.utimesSync(ac01Path, new Date(fresh), new Date(fresh))
    ac01Artifact.sha256 = createHash("sha256").update(fs.readFileSync(ac01Path)).digest("hex")
    expect(validate().code).toBe("PROOF_ARTIFACT_CONTRACT_INVALID")

    fs.writeFileSync(ac01Path, `${JSON.stringify(proofDocument(AC_CATALOG[0], ac01Artifact.kind))}\n`)
    fs.utimesSync(ac01Path, new Date(fresh), new Date(fresh))
    ac01Artifact.sha256 = createHash("sha256").update(fs.readFileSync(ac01Path)).digest("hex")
    const outside = path.join(root, "..", `outside-${Date.now()}.json`)
    fs.copyFileSync(ac01Path, outside)
    fs.utimesSync(outside, new Date(fresh), new Date(fresh))
    ac01Artifact.path = path.relative(root, outside)
    ac01Artifact.sha256 = createHash("sha256").update(fs.readFileSync(outside)).digest("hex")
    expect(validate().code).toBe("LIVE_ARTIFACT_PATH_OUTSIDE_EVIDENCE_ROOT")

    ac01Artifact.path = path.basename(ac01Path)
    ac01Artifact.sha256 = createHash("sha256").update(fs.readFileSync(ac01Path)).digest("hex")
    manifest.githubPullRequests[0].repo = "other/repository"
    expect(validate().code).toBe("GITHUB_REPOSITORY_SCOPE_INVALID")

    manifest.githubPullRequests[0].repo = "bsvalues/terragroq"
    manifest.inventory.push({
      capability: "OmittedFromCanonical",
      classification: "EXCLUDED",
      revision,
      evidence: ["none"],
    })
    expect(validate().code).toBe("V1_INVENTORY_PARITY_INVALID")
  })

  it("never converts unit or simulated checks into live acceptance", () => {
    const unitResults = Object.fromEntries(
      [...new Set(AC_CATALOG.flatMap((entry) => entry.tests))].map((file) => [file, pass()]),
    )
    const missingLive = { ok: false, code: "LIVE_MISSING", detail: null }
    const result = evaluateAcceptance({
      unitResults,
      manifestResult: missingLive,
      hostResult: missingLive,
      supervisorResult: missingLive,
      healthResult: missingLive,
      runtimeStatusResult: missingLive,
      githubResult: missingLive,
    })
    expect(result.status).toBe("FAIL")
    expect(result.result).toBe("WILLIAMOS_V1_RUNTIME_NOT_PROVEN")
    expect(result.acceptanceCriteria.every((entry) => entry.status === "FAIL")).toBe(true)
    expect(result.acceptanceCriteria.find((entry) => entry.id === "AC-02")?.checks)
      .toContainEqual(expect.objectContaining({
        name: "required-scenario-artifacts",
        proofClass: "EXECUTABLE_SCENARIO",
      }))
    expect(result.acceptanceCriteria.find((entry) => entry.id === "AC-12")?.checks)
      .toContainEqual(expect.objectContaining({
        name: "required-scenario-artifacts",
        proofClass: "VERIFIED_STATIC",
      }))
  })

  it("writes no output path unless --output is explicitly supplied", () => {
    const defaults = parseArgs([], { WILLIAMOS_HERMES_RUNTIME_ROOT: "C:\\runtime" })
    expect(defaults.output).toBeNull()
    expect(defaults.issue).toBe(448)

    const explicit = parseArgs(["--output", "acceptance.json"], {
      WILLIAMOS_HERMES_RUNTIME_ROOT: "C:\\runtime",
    })
    expect(explicit.output).toBe(path.resolve("acceptance.json"))
    expect(() => parseArgs(["--issue", "447"], {})).toThrow("ISSUE_448_REQUIRED")
    expect(() => parseArgs(["--repo", "other/repository"], {}))
      .toThrow("AUTHORIZED_REPOSITORY_REQUIRED")
  })
})
