import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({ transaction: vi.fn() }))

vi.mock("@/lib/db", () => ({ db: { transaction: seams.transaction } }))

import {
  admitExternalWorkOrder,
  boundedExternalWorkOrderFailureMetadata,
  ExternalWorkOrderAdmissionError,
  normalizeExternalWorkOrderAdmissionInput,
  previewExternalWorkOrderAdmission,
} from "@/lib/environment/external-work-order-admission"

const packet = () => ({
  source: "github",
  externalRef: "github:WilliamAGreen/william-os-devops#1111",
  title: "  Governed external admission  ",
  objective: "Bind the authorized work into the owned Space.",
  repository: "WilliamAGreen/William-OS-DevOps.git",
  authorityEvidence: ["owner-message:2026-08-30", "github:issue:1111"],
  reservedPaths: ["tests/**", "lib/environment/**"],
  forbiddenPaths: ["docs/quarantine/**"],
  validators: ["pnpm test", "pnpm lint"],
  acceptanceCriteria: ["No client-derived authority", "Exact replay is stable"],
  pullRequest: { number: 1111, headSha: "a".repeat(40) },
})

describe("external Work Order digest-bound confirmation boundary", () => {
  beforeEach(() => seams.transaction.mockReset())

  it("previews a deterministic normalized immutable packet digest without writing", () => {
    const first = previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: " space-1 ", externalWorkOrder: packet(),
    })
    const second = previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: {
        ...packet(),
        repository: "williamagreen/william-os-devops",
        reservedPaths: ["lib/environment/**", "tests/**"],
      },
    })

    expect(first.status).toBe("READY_FOR_CONFIRMATION")
    expect(first.worldId).toBe("space-1")
    expect(first.externalWorkOrder.repository).toBe("williamagreen/william-os-devops")
    expect(first.externalWorkOrder.reservedPaths).toEqual(["lib/environment/**", "tests/**"])
    expect(first.provenanceDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(second.provenanceDigest).toBe(first.provenanceDigest)
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("requires an explicit confirmation bound to the preview digest", () => {
    const preview = previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: packet(),
    })
    const admitted = normalizeExternalWorkOrderAdmissionInput({
      mode: "ADMIT",
      worldId: "space-1",
      idempotencyKey: "admit:github:1111",
      confirmation: "ADMIT_EXTERNAL_WORK_ORDER",
      confirmedProvenanceDigest: preview.provenanceDigest,
      externalWorkOrder: packet(),
    })
    expect(admitted.confirmedProvenanceDigest).toBe(preview.provenanceDigest)
  })

  it("rejects packet drift after preview before starting a transaction", async () => {
    const preview = previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: packet(),
    })
    await expect(admitExternalWorkOrder("owner-1", {
      mode: "ADMIT",
      worldId: "space-1",
      idempotencyKey: "admit:github:1111",
      confirmation: "ADMIT_EXTERNAL_WORK_ORDER",
      confirmedProvenanceDigest: preview.provenanceDigest,
      externalWorkOrder: { ...packet(), reservedPaths: ["app/**"] },
    })).rejects.toMatchObject({ code: "CONFIRMATION_STALE" } satisfies Partial<ExternalWorkOrderAdmissionError>)
    expect(seams.transaction).not.toHaveBeenCalled()
  })

  it("rejects missing confirmation and unsafe repository or reservation inputs", () => {
    expect(() => normalizeExternalWorkOrderAdmissionInput({
      mode: "ADMIT", worldId: "space-1", idempotencyKey: "admit:github:1111",
      externalWorkOrder: packet(),
    })).toThrow("CONFIRMATION_REQUIRED")
    expect(() => previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: { ...packet(), repository: "not-a-repo" },
    })).toThrow("EXTERNAL_PROVENANCE_INVALID")
    expect(() => previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: { ...packet(), reservedPaths: ["../escape"] },
    })).toThrow("EXTERNAL_PROVENANCE_INVALID")
    expect(() => previewExternalWorkOrderAdmission({
      mode: "PREVIEW", worldId: "space-1", externalWorkOrder: {
        ...packet(), reservedPaths: ["app/**"], forbiddenPaths: ["app/**"],
      },
    })).toThrow("EXTERNAL_PROVENANCE_INVALID")
  })

  // Private packet text must never be logged.
  it("bounds internal failure diagnostics without copying authority packet text", () => {
    const cause = Object.assign(new Error("sql params: authorityEvidence=owner-secret"), { code: "23505" })
    const failure = new Error("packet objective: private-plan", { cause })

    expect(boundedExternalWorkOrderFailureMetadata(failure)).toEqual({
      classification: "EXTERNAL_WORK_ORDER_ADMISSION_INTERNAL_FAILURE",
      name: "Error",
      databaseCode: "23505",
    })
    expect(JSON.stringify(boundedExternalWorkOrderFailureMetadata(failure))).not.toContain("owner-secret")
    expect(JSON.stringify(boundedExternalWorkOrderFailureMetadata(failure))).not.toContain("private-plan")
  })
})
