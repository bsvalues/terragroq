// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApplicationLoopSpine,
  deriveApplicationLoopSteps,
  type ApplicationLoopInput,
} from "@/components/workspace-shell/application-loop-spine"
import { patchDiffStat, proposalPlainSummary } from "@/components/workspace-shell/hello-application-assistant"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const baseInput: ApplicationLoopInput = {
  projectName: "Focus Board",
  runtimeState: "stopped",
  proposalStatus: null,
  requestInProgress: false,
}

const step = (input: Partial<ApplicationLoopInput>, id: string) =>
  deriveApplicationLoopSteps({ ...baseInput, ...input }).find((entry) => entry.id === id)

describe("application loop spine derivation", () => {
  it("never claims progress the product has not made", () => {
    const states = deriveApplicationLoopSteps(baseInput)
    expect(states.map((entry) => entry.id)).toEqual(["create", "start", "ask", "review"])
    expect(states.map((entry) => entry.state)).toEqual(["done", "current", "blocked", "next"])
  })

  it("marks Start done and Ask current only when the contained runtime is running", () => {
    expect(step({ runtimeState: "running" }, "start")?.state).toBe("done")
    expect(step({ runtimeState: "running" }, "ask")?.state).toBe("current")
    expect(step({ runtimeState: "running" }, "ask")?.detail).toBe("Describe one visible change")
  })

  it("blocks Ask while the contained runtime is stopped", () => {
    expect(step({ runtimeState: "stopped" }, "ask")?.state).toBe("blocked")
    expect(step({ runtimeState: "stopped" }, "ask")?.detail).toBe("Start the contained runtime first")
  })

  it("keeps checking runtime state honest rather than implying it is running", () => {
    expect(step({ runtimeState: "checking" }, "start")?.state).toBe("current")
    expect(step({ runtimeState: null }, "start")?.state).toBe("current")
  })

  it("moves Ask to done and Review to current on READY_FOR_REVIEW", () => {
    expect(step({ runtimeState: "running", proposalStatus: "READY_FOR_REVIEW" }, "ask")?.state).toBe("done")
    expect(step({ runtimeState: "running", proposalStatus: "READY_FOR_REVIEW" }, "review")?.state).toBe("current")
    expect(step({ runtimeState: "running", proposalStatus: "READY_FOR_REVIEW" }, "review")?.detail)
      .toBe("Proposal ready for your decision")
  })

  it("treats only terminal proposal statuses as done", () => {
    for (const status of ["APPLIED", "REJECTED", "QUARANTINED_ROLLBACK_FAILED"]) {
      expect(step({ runtimeState: "running", proposalStatus: status }, "review")?.state).toBe("done")
      expect(step({ runtimeState: "running", proposalStatus: status }, "review")?.detail).toBe("Receipt retained below")
    }
    expect(step({ runtimeState: "running", proposalStatus: "APPLY_IN_PROGRESS" }, "review")?.state).toBe("current")
  })

  it("does not echo the receipt status label, which would duplicate retained-receipt copy", () => {
    const states = deriveApplicationLoopSteps({ ...baseInput, runtimeState: "running", proposalStatus: "APPLIED" })
    expect(states.flatMap((entry) => [entry.label, entry.detail])).not.toContain("Applied")
  })

  it("reports an in-flight request without inventing a proposal", () => {
    expect(step({ runtimeState: "running", requestInProgress: true }, "ask")?.state).toBe("done")
    expect(step({ runtimeState: "running", requestInProgress: true }, "review")?.state).toBe("next")
  })

  it("states the project actually exists for the Create step", () => {
    expect(step({}, "create")?.detail).toBe("Focus Board exists")
    expect(step({}, "create")?.state).toBe("done")
  })
})

describe("ApplicationLoopSpine rendering", () => {
  it("renders the four steps in order with the current step marked for assistive tech", () => {
    render(<ApplicationLoopSpine {...baseInput} runtimeState="running" />)
    const loop = screen.getByRole("navigation", { name: "Focus Board application loop" })
    expect(loop).toBeTruthy()
    expect(screen.getByText("1. Create")).toBeTruthy()
    expect(screen.getByText("2. Start")).toBeTruthy()
    expect(screen.getByText("3. Ask")).toBeTruthy()
    expect(screen.getByText("4. Review & Apply")).toBeTruthy()
    expect(screen.getByText("Describe one visible change").closest("[aria-current]")?.getAttribute("aria-current"))
      .toBe("step")
  })

  it("numbers its own labels so existing product text queries stay unambiguous", () => {
    render(<ApplicationLoopSpine {...baseInput} runtimeState="running" />)
    expect(screen.queryByText("Start")).toBeNull()
    expect(screen.queryByText("Create")).toBeNull()
    expect(screen.queryByText("Ask")).toBeNull()
  })

  it("wires each actionable step to the step it names", () => {
    const onStart = vi.fn()
    const onAsk = vi.fn()
    const onReview = vi.fn()
    render(<ApplicationLoopSpine {...baseInput} runtimeState="running" onStart={onStart} onAsk={onAsk} onReview={onReview} />)
    fireEvent.click(screen.getByRole("button", { name: /Start/ }))
    fireEvent.click(screen.getByRole("button", { name: /Ask/ }))
    fireEvent.click(screen.getByRole("button", { name: /Review & Apply/ }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it("leaves Create non-interactive because the project switcher owns that step", () => {
    render(<ApplicationLoopSpine {...baseInput} runtimeState="running" />)
    expect(screen.queryByRole("button", { name: /Create/ })).toBeNull()
  })
})

describe("plain review summary", () => {
  const patch = [
    "diff --git a/index.html b/index.html",
    "--- a/index.html",
    "+++ b/index.html",
    "@@ -1,2 +1,3 @@",
    "+<h1>Focus Board</h1>",
    "-<h1>Board</h1>",
    "+<p>Ready</p>",
  ].join("\n")

  it("counts only real changed lines, never file headers", () => {
    expect(patchDiffStat(patch)).toEqual({ added: 2, removed: 1 })
    expect(patchDiffStat(null)).toEqual({ added: 0, removed: 0 })
    expect(patchDiffStat(undefined)).toEqual({ added: 0, removed: 0 })
  })

  it("states paths, diffstat, and the contained validation status verbatim", () => {
    expect(proposalPlainSummary({
      changedPaths: ["index.html", "app.js"],
      validation: { status: "passed" },
      reviewPatch: patch,
    })).toBe("This proposal changes 2 files (index.html, app.js) — +2 −1 lines. Contained validation: passed.")
  })

  it("does not claim a diffstat when no patch is retained", () => {
    expect(proposalPlainSummary({
      changedPaths: ["app.js"],
      validation: { status: "passed" },
      reviewPatch: null,
    })).toBe("This proposal changes 1 file (app.js). Contained validation: passed.")
  })
})