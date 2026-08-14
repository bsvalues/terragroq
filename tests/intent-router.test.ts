import { describe, expect, it } from "vitest"

import { routeUniversalIntent } from "@/lib/intent/router"

describe("universal intent router", () => {
  it.each([
    ["Explain why the activity feed is empty", "answer", "/chat", "respond"],
    ["Research authenticated desktop access", "research", "/brain-council", "research"],
    ["Ask the council to compare these two architectures", "council", "/brain-council", "council_review"],
    ["Draft an outcome for device enrollment", "outcome", null, "start_outcome"],
    ["Build a useful release dashboard", "outcome", null, "start_outcome"],
    ["Fix the broken Project selector", "outcome", null, "start_outcome"],
    ["Add a compact on-screen latest-evidence timestamp to selected Thread work status.", "outcome", null, "start_outcome"],
    ["Do improve the owner handoff", "outcome", null, "start_outcome"],
  ] as const)("routes %s to the %s contract", (input, intent, href, action) => {
    expect(routeUniversalIntent(input)).toMatchObject({
      state: "routed",
      intent,
      destination: { href, action },
      executionAuthorized: false,
    })
  })

  it.each([
    ["Open Projects", "/projects"],
    ["Open System", "/system"],
    ["Show Brain Council", "/brain-council"],
    ["Go to Goal Console", "/goal-console"],
    ["Visit Work Orders", "/work-orders"],
    ["Open Evidence", "/audit"],
    ["Open Knowledge", "/memory"],
    ["Open Raw Runtime", "/runtime?detail=technical"],
  ] as const)("routes known cockpit navigation %s", (input, href) => {
    expect(routeUniversalIntent(input)).toMatchObject({
      state: "routed",
      intent: "navigation",
      destination: { href, action: "navigate" },
      executionAuthorized: false,
    })
  })

  it("requires authority instead of treating an execution request as executable", () => {
    expect(routeUniversalIntent("Deploy the cockpit to production")).toMatchObject({
      state: "authority_required",
      intent: "execution",
      destination: { href: "/work-orders", action: "request_execution" },
      executionAuthorized: false,
      authority: {
        required: true,
        granted: false,
      },
    })
  })

  it("keeps non-imperative questions containing add in the answer contract", () => {
    expect(routeUniversalIntent("How do I add evidence to a Thread?")).toMatchObject({
      state: "routed",
      intent: "answer",
      destination: { href: "/chat", action: "respond" },
      executionAuthorized: false,
    })
  })

  it.each([
    "Research the rollout and deploy it",
    "Open Projects and restart the runtime",
    "Add a timestamp and deploy it",
    "Navigate to Mars",
    "   ",
  ])("fails closed when the request is ambiguous: %j", (input) => {
    const result = routeUniversalIntent(input)

    expect(result).toMatchObject({
      state: "clarification_required",
      intent: null,
      destination: null,
      executionAuthorized: false,
    })
  })
})
