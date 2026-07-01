import { describe, expect, it } from "vitest"
import { getDecisionCorrectionCaptureSurface } from "@/components/dogfood/decision-correction-capture"

describe("Decision and correction capture surface", () => {
  it("captures owner corrections, decisions, blocked gates, and lessons as candidates", () => {
    const surface = getDecisionCorrectionCaptureSurface()

    expect(surface.items.map((item) => item.label)).toEqual([
      "Owner correction",
      "Decision record",
      "Blocked gate",
      "Lesson learned",
    ])
    expect(surface.items.map((item) => item.candidateType)).toEqual([
      "correction",
      "decision",
      "blocked-gate",
      "lesson",
    ])
  })

  it("keeps review before conversion", () => {
    const surface = getDecisionCorrectionCaptureSurface()

    expect(surface.reviewFlow).toEqual([
      "capture candidate",
      "attach evidence",
      "Primary review",
      "accept, reject, or convert later",
    ])
  })

  it("does not write memory, promote canon, update training, or extract in background", () => {
    const surface = getDecisionCorrectionCaptureSurface()

    expect(surface.safety).toEqual({
      readOnlySurface: true,
      writesMemory: false,
      promotesCanon: false,
      updatesTraining: false,
      backgroundExtraction: false,
    })
  })
})
