import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")

describe("global universal intent affordance", () => {
  it("is present once in the one persistent workbench header", () => {
    const shell = source("components/workbench/workbench-shell.tsx")
    expect(shell.match(/<UniversalIntent \/>/g)).toHaveLength(1)
  })

  it("opens through Ctrl+K and never grants execution authority", () => {
    const intent = source("components/intent/universal-intent.tsx")
    expect(intent).toContain("event.ctrlKey || event.metaKey")
    expect(intent).toContain("Routing never grants execution authority")
  })

  it("keeps routed intent handoff behavior", () => {
    const intent = source("components/intent/universal-intent.tsx")
    expect(intent).toContain("storeIntentHandoff")
    expect(intent).toContain('fetch("/api/intent"')
  })
})
