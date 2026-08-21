import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { getBuildProvenance } from "@/lib/build-provenance"

/**
 * Fresh-build provenance (#762 deploy doctrine): the artifact must carry the exact commit it was
 * built from, so a stale standalone can never pass as a fresh deploy. These prove the stamp writes a
 * real SHA and the accessor reads the shape the deploy check depends on.
 */
describe("getBuildProvenance", () => {
  it("returns the sha/builtAt shape the deploy check reads", () => {
    const provenance = getBuildProvenance()
    expect(provenance).toHaveProperty("sha")
    expect(typeof provenance.sha).toBe("string")
    expect("builtAt" in provenance).toBe(true)
  })
})

describe("write-build-provenance.mjs stamps the real HEAD", () => {
  const scriptEnv = { ...process.env }
  afterEach(() => {
    // restore env the stamp reads
    process.env = scriptEnv
  })

  it("writes the current git HEAD when no override is set", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim()
    // Run the real script into a temp HOME-like check by reading what it wrote to the tracked file
    // path, but without clobbering the committed placeholder: invoke it and capture, then restore.
    const target = path.join(process.cwd(), "lib", "generated", "build-provenance.json")
    const before = fs.readFileSync(target, "utf8")
    try {
      execFileSync("node", ["scripts/write-build-provenance.mjs"], { cwd: process.cwd(), encoding: "utf8" })
      const written = JSON.parse(fs.readFileSync(target, "utf8")) as { sha: string; builtAt: string | null }
      // The stamped sha is HEAD, optionally with a -dirty suffix when the tree has changes.
      expect(written.sha.startsWith(head)).toBe(true)
      expect(written.builtAt).toBeTypeOf("string")
    } finally {
      fs.writeFileSync(target, before, "utf8")
    }
  })

  it("honors an explicit WILLIAMOS_BUILD_SHA override", () => {
    const target = path.join(process.cwd(), "lib", "generated", "build-provenance.json")
    const before = fs.readFileSync(target, "utf8")
    try {
      execFileSync("node", ["scripts/write-build-provenance.mjs"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, WILLIAMOS_BUILD_SHA: "deadbeefcafe" },
      })
      const written = JSON.parse(fs.readFileSync(target, "utf8")) as { sha: string }
      expect(written.sha).toBe("deadbeefcafe")
    } finally {
      fs.writeFileSync(target, before, "utf8")
    }
  })
})

describe("the build script chains the provenance stamp before next build", () => {
  it("runs clean-next then write-build-provenance then next build, in that order", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const build = pkg.scripts.build
    const cleanAt = build.indexOf("clean-next")
    const stampAt = build.indexOf("write-build-provenance")
    const nextAt = build.indexOf("next build")
    expect(cleanAt).toBeGreaterThanOrEqual(0)
    expect(stampAt).toBeGreaterThan(cleanAt)
    expect(nextAt).toBeGreaterThan(stampAt)
  })
})

