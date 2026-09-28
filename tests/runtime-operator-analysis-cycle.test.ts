import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { runOperationalKernelCycle } from "@/scripts/runtime-operator/operational-kernel.mjs"

describe("operational kernel — read-only analysis path", () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

  it("routes an analysis work order to the read-only lane and completes it without a patch or PR", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-analysis-"))
    roots.push(root)
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [
        {
          workOrderId: "WO-ANALYSIS-001",
          authority: "APPROVED",
          riskClass: "R0",
          dependencies: [],
          ownerGateRequired: false,
          protectedScope: false,
          baseBranch: "main",
          mergeMode: "AUTO_ELIGIBLE",
          allowedPaths: ["docs/governance/williamos-intelligence-fabric/09-whole-fabric-topology-and-placement.md"],
          requiredValidation: ["read-only"],
          task: "Analyze the fabric topology.",
          capability: "analysis",
          contextPaths: ["docs/governance/williamos-intelligence-fabric/09-whole-fabric-topology-and-placement.md"],
        },
      ],
    }
    const queue = [{ issueNumber: 950, workOrderId: "WO-ANALYSIS-001", state: "READY", createdAt: "2026-09-10T00:00:00Z" }]
    const calls: string[] = []
    const adapters = {
      assertRuntime: async () => calls.push("runtime:verified"),
      listQueue: async () => queue,
      resolveBaseSha: async () => "b".repeat(40),
      lease: async (issueNumber: number) => calls.push(`lease:${issueNumber}`),
      // The analysis path must never touch the implementation pipeline.
      prepareWorkspace: async () => { calls.push("workspace"); return "unused" },
      invokeCodex: async () => { calls.push("provider"); return { result: "PATCH_READY" } },
      publish: async () => { calls.push("publish"); return { branch: "never", pr: 0 } },
      dispatchAnalysis: async ({ workOrderId, contextPaths }: { workOrderId: string; contextPaths: string[] }) => {
        calls.push(`analysis:${workOrderId}:${contextPaths.length}`)
        return { result: "ANALYSIS_READY", findings: ["grounded finding"], evidencePath: "C:/evidence/analysis/WO-ANALYSIS-001/analysis.json" }
      },
      complete: async (issueNumber: number) => calls.push(`complete:${issueNumber}`),
    }
    const result = await runOperationalKernelCycle({ root, registry, adapters } as any)
    expect(result.state).toBe("COMPLETED")
    // Lease, analyze, complete — and never a workspace, provider call, or publish.
    expect(calls).toEqual([
      "runtime:verified",
      "lease:950",
      "analysis:WO-ANALYSIS-001:1",
      "complete:950",
    ])
    expect(calls).not.toContain("workspace")
    expect(calls).not.toContain("provider")
    expect(calls).not.toContain("publish")
  })

  it("refuses to run the analysis path when the lane reports anything but a ready analysis result", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "williamos-kernel-analysis-wall-"))
    roots.push(root)
    const registry = {
      schemaVersion: 1,
      repository: "bsvalues/terragroq",
      workOrders: [{
        workOrderId: "WO-ANALYSIS-002", authority: "APPROVED", riskClass: "R0", dependencies: [],
        ownerGateRequired: false, protectedScope: false, baseBranch: "main", mergeMode: "AUTO_ELIGIBLE",
        allowedPaths: ["docs/ARCHITECTURE.md"], requiredValidation: ["read-only"], task: "t",
        capability: "analysis", contextPaths: ["docs/ARCHITECTURE.md"],
      }],
    }
    const queue = [{ issueNumber: 951, workOrderId: "WO-ANALYSIS-002", state: "READY", createdAt: "2026-09-10T00:00:00Z" }]
    const adapters = {
      assertRuntime: async () => {},
      listQueue: async () => queue,
      resolveBaseSha: async () => "b".repeat(40),
      lease: async () => {},
      dispatchAnalysis: async () => ({ result: "PATCH_READY" }),
      complete: async () => {},
    }
    const outcome = await runOperationalKernelCycle({ root, registry, adapters } as any)
    // A non-ANALYSIS_READY result is a typed terminal failure, never a silent completion or a patch.
    expect(outcome.state).toBe("FAILED_TERMINAL")
    expect(outcome.failureCode).toContain("ANALYSIS_DISPATCH_WALL")
  })
})
