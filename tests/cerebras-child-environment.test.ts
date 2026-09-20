import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { withoutCerebrasChildEnvironment } from "../lib/loom/child-environment"

describe("Cerebras credential isolation from workspace child processes", () => {
  it("masks the provider credential and enable flag without mutating the server environment", () => {
    const parent = { NODE_ENV: "test" as const, PATH: "fixture-path", CEREBRAS_API_KEY: "fixture-only", WILLIAMOS_CEREBRAS_ENABLED: "true" }
    expect(withoutCerebrasChildEnvironment(parent)).toEqual({ NODE_ENV: "test", PATH: "fixture-path",
      CEREBRAS_API_KEY: "", WILLIAMOS_CEREBRAS_ENABLED: "false" })
    expect(withoutCerebrasChildEnvironment({ NODE_ENV: "test" })).toMatchObject({
      CEREBRAS_API_KEY: "", WILLIAMOS_CEREBRAS_ENABLED: "false",
    })
    expect(parent.CEREBRAS_API_KEY).toBe("fixture-only")
  })

  it("scrubs the child environments of cockpit test, build, edit and search paths", () => {
    for (const relativePath of [
      "app/api/loom/edit/route.ts",
      "app/api/loom/search/route.ts",
      "app/api/environment/line/route.ts",
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
      expect(source).toContain("withoutCerebrasChildEnvironment(process.env)")
    }
    const run = fs.readFileSync(path.join(process.cwd(), "app/api/loom/run/route.ts"), "utf8")
    expect(run).toContain("withoutCerebrasChildEnvironment({ ...process.env, ...operation.env")
    const agent = fs.readFileSync(path.join(process.cwd(), "app/api/loom/agent/route.ts"), "utf8")
    expect(agent).toContain("withoutCerebrasChildEnvironment({ ...process.env")
    const assignment = fs.readFileSync(path.join(process.cwd(), "lib/loom/codex-assignment.ts"), "utf8")
    expect(assignment).toContain("env: withoutCerebrasChildEnvironment(process.env)")
    const diff = fs.readFileSync(path.join(process.cwd(), "lib/loom/workspace-diff.ts"), "utf8")
    expect(diff.match(/env: withoutCerebrasChildEnvironment\(process\.env\)/g)).toHaveLength(2)
    const isolated = fs.readFileSync(path.join(process.cwd(), "lib/loom/codex-isolated-workspace.ts"), "utf8")
    expect(isolated).toContain("env: withoutCerebrasChildEnvironment(process.env)")
    const productReceipt = fs.readFileSync(path.join(process.cwd(), "lib/environment/external-product-terminal-receipt.ts"), "utf8")
    expect(productReceipt.match(/env: withoutCerebrasChildEnvironment\(process\.env\)/g)).toHaveLength(2)
    const adoption = fs.readFileSync(path.join(process.cwd(), "lib/governance/artifact-adoption-runtime.ts"), "utf8")
    expect(adoption).toContain("env: withoutCerebrasChildEnvironment(process.env)")
    expect(adoption).toContain("execute: CommandRunner = defaultCommandRunner")
    const workContext = fs.readFileSync(path.join(process.cwd(), "lib/governance/work-context-live.ts"), "utf8")
    expect(workContext.match(/env: withoutCerebrasChildEnvironment\(process\.env\)/g)).toHaveLength(2)
  })
})
