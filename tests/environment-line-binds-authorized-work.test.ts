import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createWorkingWorld, withBoundOutcome, withExecution } from "@/lib/environment/working-world"

const route = fs.readFileSync(path.join(process.cwd(), "app/api/environment/line/route.ts"), "utf8")

const retained = {
  projectId: 7,
  projectName: "TerraFusion",
  threadId: "thread-7",
  outcomeKey: "outcome:7",
  outcomeTitle: "ship the cutover",
  activeWorkOrderId: 1011,
} as const

describe("an authorized retained selection becomes the mounted world's work", () => {
  it("binds the exact retained tuple and advances the spine to authorized", () => {
    const world = withExecution(
      withBoundOutcome(createWorkingWorld({ intent: "continue" }), retained),
      { execution: "authorized", at: "2026-08-25T09:00:00Z" },
    )

    expect(world.spine).toMatchObject({
      projectId: 7,
      threadId: "thread-7",
      outcomeKey: "outcome:7",
      workOrderId: 1011,
      execution: "authorized",
    })
  })

  it("applies that transition in the successful startRetainedWork branch", () => {
    const start = route.indexOf("const retained = world.pendingStartWork")
    const end = route.indexOf("} else if (isContinueIntent(text))", start)
    const authorizedBranch = route.slice(start, end)

    expect(authorizedBranch).toContain("const outcome = await startRetainedWork(retained)")
    expect(authorizedBranch).toContain("withBoundOutcome(updated, retained)")
    expect(authorizedBranch).toContain('execution: "authorized"')
  })
})
