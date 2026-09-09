import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock("@/lib/db", () => ({ db: { transaction: seams.transaction } }))

import {
  admitExternalParentMission,
  EXTERNAL_PARENT_MISSION_BINDING_VERSION,
  EXTERNAL_PARENT_MISSION_DECOMPOSITION_VERSION,
  EXTERNAL_PARENT_MISSION_BIND_OPERATION,
  EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION,
  externalParentMissionBindReceiptHash,
  externalParentMissionDecompositionPolicyDigest,
  externalParentMissionProvenanceDigest,
  normalizeExternalParentMission,
  normalizeExternalParentMissionDecompositionAdmissionInput,
  normalizeExternalParentMissionDecompositionPreviewInput,
  normalizeExternalParentMissionAdmissionInput,
  terminalExternalParentMission,
  previewExternalParentMissionAdmission,
  resolveExternalParentMissionReceipts,
} from "@/lib/environment/external-parent-mission-admission"
import { hashRecord } from "@/lib/governance/hash"

const mission = () => ({
  source: "github" as const,
  repository: "BSValues/TerraFusion_OS_1.0.git",
  externalRef: "github:bsvalues/terrafusion_os_1.0#1485",
  issueNumber: 1485,
  goalRef: "GOAL-WASHINGTON-ASSESSOR-LAUNCH-V1",
  loopRef: "LOOP-WASHINGTON-ASSESSOR-LAUNCH-V1",
  objective: "Launch the complete Washington assessor product mission.",
  terminalConditions: ["External assessor acceptance", "All 39 counties proven"],
  authorityEvidence: ["owner-directive:issue-1485", "github:bsvalues/terrafusion_os_1.0#1485"],
})

const decompositionPolicy = () => ({
  version: EXTERNAL_PARENT_MISSION_DECOMPOSITION_VERSION,
  executionPowers: ["child:derive", "child:dispatch"],
  pathReservationCeiling: ["lib/outcome-queue/**", "tests/**"],
  contractReservationCeiling: [],
  environmentReservationCeiling: [],
  hardWalls: {
    singleRepositoryPerChild: true,
    exactReservationSubset: true,
    noAuthorityEscalation: true,
    childExpiryNoLaterThanParent: true,
    deterministicChildIdentity: true,
    atomicChildLineage: true,
    rawProseAuthorityForbidden: true,
    parentCompletionInferenceForbidden: true,
    crossBoundaryWideningForbidden: true,
  },
})

function admittedInput() {
  const preview = previewExternalParentMissionAdmission({
    mode: "PREVIEW",
    worldId: "space-terrafusion",
    externalParentMission: mission(),
  })
  return {
    mode: "ADMIT",
    worldId: "space-terrafusion",
    idempotencyKey: "external-parent:1485",
    confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
    confirmedProvenanceDigest: preview.provenanceDigest,
    externalParentMission: mission(),
  }
}

describe("external parent mission admission contract", () => {
  beforeEach(() => seams.transaction.mockReset())

  it("normalizes and previews a stable owner-confirmed mission without writing", () => {
    const preview = previewExternalParentMissionAdmission({
      mode: "PREVIEW", worldId: " space-terrafusion ", externalParentMission: mission(),
    })
    expect(preview).toMatchObject({
      status: "READY_FOR_CONFIRMATION",
      worldId: "space-terrafusion",
      externalParentMission: {
        repository: "bsvalues/terrafusion_os_1.0",
        terminalConditions: ["All 39 counties proven", "External assessor acceptance"],
      },
    })
    expect(preview.missionKey).toMatch(/^external-parent:[0-9a-f]{64}$/)
    expect(preview.provenanceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("rejects issue identity mismatch and post-confirmation drift before persistence", async () => {
    expect(() => previewExternalParentMissionAdmission({
      mode: "PREVIEW",
      worldId: "space-terrafusion",
      externalParentMission: { ...mission(), externalRef: "github:bsvalues/terrafusion_os_1.0#1486" },
    })).toThrow("EXTERNAL_PARENT_MISSION_INVALID")

    const input = admittedInput()
    await expect(admitExternalParentMission("owner", {
      ...input,
      externalParentMission: { ...mission(), objective: "Drifted objective" },
    })).rejects.toMatchObject({ code: "CONFIRMATION_STALE" })
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("does not let arbitrary evidence references assert SATISFIED", async () => {
    await expect(terminalExternalParentMission("owner", {
      mode: "TERMINAL",
      missionKey: `external-parent:${"a".repeat(64)}`,
      bindReceiptId: 11,
      bindReceiptHash: "b".repeat(64),
      terminalState: "SATISFIED",
      terminalEvidenceRefs: ["caller-says:done"],
      idempotencyKey: "external-parent:1485:terminal",
    })).rejects.toMatchObject({ code: "PARENT_MISSION_TERMINAL_EVIDENCE_UNVERIFIED" })
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("requires exact fields, explicit confirmation, and nonempty authority and terminal evidence", () => {
    const input = admittedInput() as Record<string, unknown>
    delete input.confirmation
    expect(() => normalizeExternalParentMissionAdmissionInput(input)).toThrow("CONFIRMATION_REQUIRED")
    expect(() => previewExternalParentMissionAdmission({
      mode: "PREVIEW", worldId: "space-terrafusion",
      externalParentMission: { ...mission(), authorityEvidence: [] },
    })).toThrow("EXTERNAL_PARENT_MISSION_INVALID")
    expect(() => previewExternalParentMissionAdmission({
      mode: "PREVIEW", worldId: "space-terrafusion",
      externalParentMission: { ...mission(), unexpected: true },
    })).toThrow("EXTERNAL_PARENT_MISSION_INVALID")
  })

  it("keeps v1 immutable and normalizes a separate exact v2 decomposition packet", () => {
    const normalizedMission = normalizeExternalParentMission(mission())
    expect(externalParentMissionProvenanceDigest(normalizedMission)).toBe(hashRecord({
      version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
      externalParentMission: normalizedMission,
    }))
    expect(normalizedMission).not.toHaveProperty("decompositionAuthority")

    const previewInput = normalizeExternalParentMissionDecompositionPreviewInput({
      mode: "DECOMPOSITION_PREVIEW",
      worldId: "space-terrafusion",
      missionKey: `external-parent:${"a".repeat(64)}`,
      bindReceiptId: 135,
      bindReceiptHash: "b".repeat(64),
      policy: decompositionPolicy(),
    })
    const policyDigest = externalParentMissionDecompositionPolicyDigest(previewInput)
    expect(normalizeExternalParentMissionDecompositionAdmissionInput({
      ...previewInput,
      mode: "DECOMPOSITION_ADMIT",
      idempotencyKey: "parent-decomposition:1485",
      confirmation: "ADMIT_EXTERNAL_PARENT_MISSION_DECOMPOSITION",
      confirmedPolicyDigest: policyDigest,
    })).toMatchObject({ policy: decompositionPolicy(), confirmedPolicyDigest: policyDigest })

    expect(() => normalizeExternalParentMissionDecompositionPreviewInput({
      ...previewInput,
      workOrderId: 99,
    })).toThrow("REQUEST_FIELDS_INVALID")
    expect(() => normalizeExternalParentMissionDecompositionPreviewInput({
      ...previewInput,
      policy: { ...decompositionPolicy(), hardWalls: { ...decompositionPolicy().hardWalls, noAuthorityEscalation: false } },
    })).toThrow("PARENT_MISSION_DECOMPOSITION_INVALID")
    expect(() => normalizeExternalParentMission({
      ...mission(),
      decompositionAuthority: decompositionPolicy(),
    })).toThrow("EXTERNAL_PARENT_MISSION_INVALID")
  })


  it("classifies one exact unresolved bind and a separately hash-bound terminal receipt", () => {
    const input = normalizeExternalParentMissionAdmissionInput(admittedInput())
    const preview = previewExternalParentMissionAdmission({
      mode: "PREVIEW", worldId: input.worldId, externalParentMission: input.externalParentMission,
    })
    const requestBinding = {
      version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
      worldId: input.worldId,
      idempotencyKey: input.idempotencyKey,
      confirmation: input.confirmation,
      confirmedProvenanceDigest: input.confirmedProvenanceDigest,
      externalParentMission: input.externalParentMission,
      provenanceDigest: preview.provenanceDigest,
      missionKey: preview.missionKey,
    }
    const binding = {
      version: EXTERNAL_PARENT_MISSION_BINDING_VERSION,
      source: "github",
      repository: input.externalParentMission.repository,
      externalRef: input.externalParentMission.externalRef,
      issueNumber: input.externalParentMission.issueNumber,
      goalRef: input.externalParentMission.goalRef,
      projectId: 4,
      objectiveDigest: hashRecord(input.externalParentMission.objective),
      missionKey: preview.missionKey,
    }
    const bind = {
      id: 11,
      userId: "owner",
      idempotencyKey: input.idempotencyKey,
      operation: EXTERNAL_PARENT_MISSION_BIND_OPERATION,
      outcomeKey: preview.missionKey,
      requestHash: hashRecord(requestBinding),
      requestBinding,
      resultBinding: {
        binding,
        worldId: input.worldId,
        repositoryResourceId: 9,
        loopRef: input.externalParentMission.loopRef,
        terminalConditionsDigest: hashRecord(input.externalParentMission.terminalConditions),
        authorityEvidenceDigest: hashRecord(input.externalParentMission.authorityEvidence),
        authorityEvidenceRole: "SUPPORTING_ONLY",
        provenanceDigest: preview.provenanceDigest,
        state: "ACTIVE",
        admittedBy: "owner",
        authorityProvenance: {
          kind: "AUTHENTICATED_CONFIGURED_OWNER_ADMISSION",
          ownerUserId: "owner",
          confirmation: "ADMIT_EXTERNAL_PARENT_MISSION",
          provenanceDigest: preview.provenanceDigest,
        },
        admittedAt: "2026-09-07T12:00:00.000Z",
      },
      createdAt: new Date("2026-09-07T12:00:00.000Z"),
    }
    expect(resolveExternalParentMissionReceipts([bind])).toEqual({
      integrity: "VERIFIED",
      unresolved: [{
        missionKey: preview.missionKey,
        externalRef: input.externalParentMission.externalRef,
        goalRef: input.externalParentMission.goalRef,
        worldId: "space-terrafusion",
        projectId: 4,
        repository: "bsvalues/terrafusion_os_1.0",
      }],
      resolved: [],
    })

    const evidence = ["evidence:external-assessor-acceptance", "protected-main:abc"]
    const terminalRequest = {
      version: "external-parent-mission-terminal.v1",
      missionKey: preview.missionKey,
      bindReceiptId: bind.id,
      bindReceiptHash: externalParentMissionBindReceiptHash(bind),
      terminalState: "SATISFIED",
      terminalEvidenceRefs: [...evidence].sort(),
      idempotencyKey: "external-parent:1485:terminal",
    }
    const terminal = {
      id: 12,
      userId: "owner",
      idempotencyKey: terminalRequest.idempotencyKey,
      operation: EXTERNAL_PARENT_MISSION_TERMINAL_OPERATION,
      outcomeKey: preview.missionKey,
      requestHash: hashRecord(terminalRequest),
      requestBinding: terminalRequest,
      resultBinding: {
        version: "external-parent-mission-terminal.v1",
        missionKey: preview.missionKey,
        bindReceiptId: bind.id,
        bindReceiptHash: terminalRequest.bindReceiptHash,
        state: "SATISFIED",
        terminalEvidenceDigest: hashRecord(terminalRequest.terminalEvidenceRefs),
        terminalAt: "2026-09-07T13:00:00.000Z",
      },
      createdAt: new Date("2026-09-07T13:00:00.000Z"),
    }
    expect(resolveExternalParentMissionReceipts([bind, terminal])).toEqual({
      integrity: "VERIFIED",
      unresolved: [],
      resolved: [{
        missionKey: preview.missionKey,
        externalRef: input.externalParentMission.externalRef,
        goalRef: input.externalParentMission.goalRef,
        worldId: "space-terrafusion",
        projectId: 4,
        repository: "bsvalues/terrafusion_os_1.0",
        terminalState: "SATISFIED",
      }],
    })
    expect(resolveExternalParentMissionReceipts([
      bind,
      { ...terminal, resultBinding: { ...terminal.resultBinding, bindReceiptHash: "0".repeat(64) } },
    ])).toEqual({ integrity: "BINDING_REQUIRED", unresolved: [], resolved: [] })
    expect(resolveExternalParentMissionReceipts([terminal])).toEqual({
      integrity: "BINDING_REQUIRED", unresolved: [], resolved: [],
    })
  })
})

describe("external parent mission route boundary", () => {
  it("rejects cross-origin browser mutation before authentication or persistence", async () => {
    vi.resetModules()
    const getSession = vi.fn()
    vi.doMock("@/lib/session", () => ({ getSession }))
    const { POST } = await import("@/app/api/environment/space/external-parent-mission/route")
    const response = await POST(new Request(
      "https://192.168.88.9:3443/api/environment/space/external-parent-mission",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "192.168.88.9:3443",
        },
        body: JSON.stringify(admittedInput()),
      },
    ))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "CROSS_ORIGIN_REFUSED" })
    expect(getSession).not.toHaveBeenCalled()
  })

  it("requires the authenticated caller to be the configured owner", async () => {
    seams.transaction.mockClear()
    vi.resetModules()
    vi.doMock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "intruder" } })) }))
    vi.doMock("@/lib/governance/owner", () => ({
      resolveOwnerUserId: vi.fn(async () => "owner"),
      assertOwner: vi.fn(() => ({ ok: false, failure: "NOT_OWNER", detail: "only the owner" })),
    }))
    vi.doMock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))
    const { POST } = await import("@/app/api/environment/space/external-parent-mission/route")
    const response = await POST(new Request(
      "https://192.168.88.9:3443/api/environment/space/external-parent-mission",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://192.168.88.9:3443",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "192.168.88.9:3443",
        },
        body: JSON.stringify(admittedInput()),
      },
    ))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: "NOT_OWNER" })
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("routes an authenticated configured-owner TERMINAL request to the narrow terminal writer", async () => {
    vi.resetModules()
    const terminal = vi.fn(async () => ({
      status: "TERMINAL_RECORDED",
      replayed: false,
      receiptId: 12,
      missionKey: `external-parent:${"a".repeat(64)}`,
      bindReceiptId: 11,
      bindReceiptHash: "b".repeat(64),
      terminalState: "REVOKED",
      terminalEvidenceDigest: "c".repeat(64),
      terminalAt: "2026-09-07T14:00:00.000Z",
    }))
    vi.doMock("@/lib/session", () => ({ getSession: vi.fn(async () => ({ user: { id: "owner" } })) }))
    vi.doMock("@/lib/governance/owner", () => ({
      resolveOwnerUserId: vi.fn(async () => "owner"),
      assertOwner: vi.fn(() => ({ ok: true })),
    }))
    vi.doMock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))
    vi.doMock("@/lib/environment/external-parent-mission-admission", () => ({
      admitExternalParentMission: vi.fn(),
      previewExternalParentMissionAdmission: vi.fn(),
      terminalExternalParentMission: terminal,
      ExternalParentMissionAdmissionError: class extends Error {},
    }))
    const { POST } = await import("@/app/api/environment/space/external-parent-mission/route")
    const body = {
      mode: "TERMINAL",
      missionKey: `external-parent:${"a".repeat(64)}`,
      bindReceiptId: 11,
      bindReceiptHash: "b".repeat(64),
      terminalState: "REVOKED",
      terminalEvidenceRefs: ["owner-revocation:issue-1485"],
      idempotencyKey: "external-parent:1485:terminal",
    }
    const response = await POST(new Request(
      "https://192.168.88.9:3443/api/environment/space/external-parent-mission",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://192.168.88.9:3443",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "192.168.88.9:3443",
        },
        body: JSON.stringify(body),
      },
    ))
    expect(response.status).toBe(201)
    expect(terminal).toHaveBeenCalledWith("owner", body)
  })
})
