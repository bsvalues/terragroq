import { describe, expect, it } from "vitest"
import { buildWorkOrderDraftPacket, type WorkOrderDraftPacketInput } from "@/components/work-orders/work-order-draft-packet"

const draft: WorkOrderDraftPacketInput = {
  title: "Clarify runtime evidence",
  goal: "Show recent verification without mutating state",
  lane: "UX readiness",
  phase: "WO-033",
  scope: "components/work-orders/**",
  nonGoals: "No execution changes",
  allowedFiles: "components/work-orders/**",
  forbiddenFiles: "lib/db/schema.ts",
  validators: "npm test -- --run\nnpm run build",
  stopConditions: "Package change required",
  acceptanceCriteria: "Packet is copyable",
  loop: "draft -> review -> validate",
  priority: "medium",
  assignee: "",
  authorityLevel: "A0_READ_ONLY",
  agent: "none",
}

describe("work order draft packet", () => {
  it("formats the draft as a reviewable handoff packet", () => {
    const packet = buildWorkOrderDraftPacket(draft)

    expect(packet).toContain("WORK_ORDER_DRAFT_REVIEW")
    expect(packet).toContain("TITLE: Clarify runtime evidence")
    expect(packet).toContain("AUTHORITY_REQUESTED: A0_READ_ONLY")
    expect(packet).toContain("AGENT: not assigned")
    expect(packet).toContain("npm run build")
  })

  it("keeps authority boundaries explicit", () => {
    const packet = buildWorkOrderDraftPacket(draft)

    expect(packet).toContain("does not approve execution")
    expect(packet).toContain("commit")
    expect(packet).toContain("push")
    expect(packet).toContain("database mutation")
  })
})
