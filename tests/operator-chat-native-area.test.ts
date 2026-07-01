import { describe, expect, it } from "vitest"
import { getOperatorChatNativeArea } from "@/components/chat/operator-chat-native-area"

describe("Operator Chat native area", () => {
  it("frames Operator Chat as the native WilliamOS command conversation surface", () => {
    const area = getOperatorChatNativeArea()

    expect(area.title).toBe("Operator Chat")
    expect(area.eyebrow).toBe("WilliamOS Command Conversation")
    expect(area.description).toContain("native WilliamOS command conversation")
    expect(area.description).toContain("Primary")
    expect(area.description).toContain("without autonomous execution")
    expect(area.postureSummary).toEqual([
      expect.objectContaining({
        label: "Conversation",
        value: "Primary-centered",
      }),
      expect.objectContaining({
        label: "Context",
        value: "grounded",
      }),
      expect.objectContaining({
        label: "Authority",
        value: "required",
      }),
    ])
  })

  it("shows command conversation sections from ask through safe handoff", () => {
    const area = getOperatorChatNativeArea()
    const labels = area.sections.map((section) => section.label)

    expect(labels).toEqual([
      "Ask",
      "Inspect",
      "Prepare",
      "Route",
      "Review",
      "Draft Next Move",
      "Safe Handoff",
    ])
    expect(area.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Prepare",
        posture: "Draft only",
      }),
      expect.objectContaining({
        label: "Draft Next Move",
        posture: "Authority gated",
      }),
      expect.objectContaining({
        label: "Safe Handoff",
        posture: "No dispatch",
      }),
    ]))
  })

  it("connects Operator Chat to Work Orders, Evidence, Decisions, and Memory", () => {
    const area = getOperatorChatNativeArea()
    const links = new Map(area.links.map((link) => [link.label, link.href]))

    expect(links.get("Work Orders")).toBe("/work-orders")
    expect(links.get("Evidence")).toBe("/audit")
    expect(links.get("Decisions")).toBe("/decisions")
    expect(links.get("Memory")).toBe("/memory")
  })

  it("does not change chat runtime, retrieval, execution, auth, access, or production behavior", () => {
    const area = getOperatorChatNativeArea()

    expect(area.safety).toEqual({
      nativeToWilliamOS: true,
      changesChatRuntime: false,
      changesModelProvider: false,
      changesMessagePersistence: false,
      changesMemoryWrites: false,
      changesRetrieval: false,
      activatesToolExecution: false,
      activatesAutonomousAction: false,
      executesWorkOrders: false,
      changesAuthBehavior: false,
      activatesAccessGrants: false,
      mutatesSchema: false,
      changesEnv: false,
      changesPackage: false,
      changesVercelSettings: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    })
    expect(area.authorityBoundaries).toEqual([
      expect.objectContaining({
        label: "Runtime",
        state: "Unchanged",
      }),
      expect.objectContaining({
        label: "Retrieval",
        state: "Unchanged",
      }),
      expect.objectContaining({
        label: "Execution",
        state: "Blocked",
      }),
    ])
  })

  it("avoids generic chatbot, productivity, and autonomous worker copy", () => {
    const area = getOperatorChatNativeArea()
    const text = [
      area.title,
      area.eyebrow,
      area.description,
      ...area.postureSummary.flatMap((item) => [item.label, item.value, item.description]),
      ...area.sections.flatMap((section) => [
        section.label,
        section.posture,
        section.purpose,
        section.boundary,
        section.evidenceLinkage,
        section.nextSafeStep,
      ]),
      ...area.authorityBoundaries.flatMap((boundary) => [
        boundary.label,
        boundary.state,
        boundary.description,
      ]),
      ...area.links.flatMap((link) => [link.label, link.description]),
      ...area.suggestions,
    ].join(" ")

    expect(text).not.toMatch(
      /chatbot|AI assistant|copilot|productivity assistant|ask me anything|chat with your data|one-click automation|autonomous agent|launch worker|unleash|boost|magic|always-on AI/i,
    )
  })
})
