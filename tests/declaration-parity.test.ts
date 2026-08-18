import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Every runtime export of a `.mjs` must be declared in the `.d.mts` beside it.
 *
 * This has now broken `main` twice, the same way both times: an export was added to the `.mjs` and the
 * declaration file was not updated. Nothing went red, because **vitest does not typecheck** -- so the
 * whole suite stayed green while `tsc --noEmit` failed. The gap is structural, not careless: the file
 * that would have caught it is not the file anyone runs.
 *
 * Comparing the two as data closes it, and does so in the suite people actually run.
 */

const ROOT = path.resolve(__dirname, "..")

const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".next", "dist", "build", ".williamos"])

/**
 * Discovered, not listed.
 *
 * A hardcoded list guards the pairs that existed the day it was written and silently misses the next
 * one -- which is the same shape as the bug this file exists to catch. Walking for them means a new
 * pair is covered the moment it appears, without anyone remembering to add it here.
 */
function findPairs(directory: string, found: [string, string][] = []): [string, string][] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) findPairs(full, found)
    } else if (entry.name.endsWith(".d.mts")) {
      const implementation = full.slice(0, -".d.mts".length) + ".mjs"
      if (fs.existsSync(implementation)) {
        found.push([path.relative(ROOT, implementation), path.relative(ROOT, full)])
      }
    }
  }
  return found
}

const PAIRS = findPairs(ROOT)



/** Names exported at runtime: `export function x`, `export const x`, `export async function x`. */
function runtimeExports(source: string): string[] {
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((match) => match[1])
  return [...new Set(names)].sort()
}

/** Names the declaration file promises: `export declare ...`, plus `export interface/type`. */
function declaredExports(source: string): string[] {
  const names = [...source.matchAll(/^export\s+declare\s+(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((match) => match[1])
  return [...new Set(names)].sort()
}

describe.each(PAIRS)("%s declares everything it exports", (implPath, declPath) => {
  const impl = fs.readFileSync(path.join(ROOT, implPath), "utf8")
  const decl = fs.readFileSync(path.join(ROOT, declPath), "utf8")

  it("declares every runtime export", () => {
    const missing = runtimeExports(impl).filter((name) => !declaredExports(decl).includes(name))
    expect(missing, `${declPath} is missing: ${missing.join(", ")}`).toEqual([])
  })

  it("does not promise exports that no longer exist", () => {
    // The opposite drift is quieter but worse: callers typecheck against something that is not there
    // at runtime, and fail only when the line actually executes.
    const phantom = declaredExports(decl).filter((name) => !runtimeExports(impl).includes(name))
    expect(phantom, `${declPath} declares absent exports: ${phantom.join(", ")}`).toEqual([])
  })
})

describe("the discovery itself", () => {
  // If the walk ever returned nothing, every describe.each above would vanish and the suite would go
  // green having checked nothing at all -- the quietest possible failure.
  it("finds the pairs that are known to exist", () => {
    const implementations = PAIRS.map(([impl]) => impl.split(path.sep).join("/"))
    expect(implementations).toContain("lib/fabric/run-baseline.mjs")
    expect(implementations).toContain("scripts/governance/device-session.mjs")
  })

  it("pairs each declaration with its own sibling implementation", () => {
    for (const [impl, decl] of PAIRS) {
      expect(impl.slice(0, -".mjs".length)).toBe(decl.slice(0, -".d.mts".length))
    }
  })
})

describe("the parity check itself", () => {
  // A matcher that silently stopped matching would make every assertion above pass vacuously.
  it("finds the exports it is supposed to find", () => {
    const source = [
      "export function alpha() {}",
      "export const beta = 1",
      "export async function gamma() {}",
      "const notExported = 2",
      "export { alpha as delta }",
    ].join("\n")
    expect(runtimeExports(source)).toEqual(["alpha", "beta", "gamma"])
  })

  it("reads declarations, not implementations", () => {
    expect(declaredExports("export declare function alpha(x: string): void")).toEqual(["alpha"])
    expect(declaredExports("export function alpha() {}")).toEqual([])
  })
})
