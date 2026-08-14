import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const chatPage = readFileSync("app/(shell)/chat/page.tsx", "utf8")
const chat = readFileSync("components/chat/operator-chat.tsx", "utf8")
const goalPage = readFileSync("app/(shell)/goal-console/page.tsx", "utf8")
const goal = readFileSync("components/goal-console/goal-console-view.tsx", "utf8")
const council = readFileSync("app/(shell)/brain-council/page.tsx", "utf8")
const workOrders = readFileSync("app/(shell)/work-orders/page.tsx", "utf8")

describe("universal intent destination handoff", () => {
  it("prefills answer intent in Operator Chat", () => {
    expect(chatPage).not.toContain("searchParams")
    expect(chat).toContain('useRoutedIntent("/chat")')
    expect(chat).toContain("setInput(routedIntent)")
  })

  it("prefills outcome intent in Goal Console without submitting it", () => {
    expect(goalPage).not.toContain("routedIntentParam")
    expect(goal).toContain('useRoutedIntent("/goal-console")')
    expect(goal).toContain("setCommand(routedIntent)")
  })

  it("shows research, Council, and execution requests as non-authorizing context", () => {
    expect(council).toContain("<RoutedIntentContext")
    expect(workOrders).toContain("<RoutedIntentContext")
    const context = readFileSync("components/intent/routed-intent-context.tsx", "utf8")
    expect(context).toContain("useRoutedIntent(destination)")
    expect(context).toContain("No action has been executed")
    expect(council).not.toContain("searchParams")
    expect(workOrders).not.toContain("searchParams")
  })
})
