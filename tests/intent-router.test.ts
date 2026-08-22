import { describe, expect, it } from "vitest"

import { routeUniversalIntent } from "@/lib/intent/router"

describe("universal intent router", () => {
  it.each([
    ["Explain why the activity feed is empty", "answer", "/", "respond"],
    ["Research authenticated desktop access", "research", "/brain-council", "research"],
    ["Ask the council to compare these two architectures", "council", "/brain-council", "council_review"],
    ["Draft an outcome for device enrollment", "outcome", null, "start_outcome"],
    ["Build a useful release dashboard", "outcome", null, "start_outcome"],
    ["Fix the broken Project selector", "outcome", null, "start_outcome"],
    ["Add a compact on-screen latest-evidence timestamp to selected Thread work status.", "outcome", null, "start_outcome"],
    ["record structured #911 reliability remediation without host mutation", "outcome", null, "start_outcome"],
    ["  RECORD structured #911 reliability remediation without host mutation...  ", "outcome", null, "start_outcome"],
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
      destination: { href: "/", action: "respond" },
      executionAuthorized: false,
    })
  })

  it.each([
    "Research the rollout and deploy it",
    "Open Activity and restart the runtime",
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

  it.each([
    "record structured #912 reliability remediation without host mutation",
    "record structured #911 reliability remediation with host mutation",
    "record structured #911 reliability remediation without host mutation later",
  ])("does not elevate a near-match of the registered #911 outcome: %j", (input) => {
    expect(routeUniversalIntent(input)).toMatchObject({
      state: "clarification_required",
      intent: null,
      destination: null,
      executionAuthorized: false,
    })
  })
})

describe("the workroom and the lab are reachable by name", () => {
  // Both surfaces shipped with no entry anywhere, so they existed only for someone who already knew
  // the URL. Primary navigation is deliberately capped at four, so the way to reach them is the
  // intent router -- which means the words the operator would actually type have to resolve.
  const target = (phrase) => routeUniversalIntent(phrase)?.destination?.href ?? null

  it("routes the words an operator would use for the workroom", () => {
    for (const phrase of ["open the workroom", "show me the loom", "go to the editor"]) {
      expect(target(phrase)).toBe("/loom")
    }
  })

  it("routes the lab by the words used for it in practice", () => {
    // "servers" and "machines" are what it actually gets called, far more often than "fabric".
    for (const phrase of ["show me the servers", "open the lab", "go to the machines", "show the nodes"]) {
      expect(target(phrase)).toBe("/fabric")
    }
  })

  it("does not navigate without a navigation signal", () => {
    // "the servers are slow" is a statement, not a request to go somewhere.
    expect(target("the servers are slow")).not.toBe("/fabric")
  })
})
