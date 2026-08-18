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

const PAIRS = [
  ["lib/fabric/run-baseline.mjs", "lib/fabric/run-baseline.d.mts"],
  ["scripts/governance/device-session.mjs", "scripts/governance/device-session.d.mts"],
] as const

const ROOT = path.resolve(__dirname, "..")

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
