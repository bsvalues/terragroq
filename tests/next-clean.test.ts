import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"

/**
 * The clean step must not delete through a symlink.
 *
 * Next's standalone output links `.next/standalone/node_modules/next` at the real package inside
 * pnpm's store. A clean that follows that link empties the store package, and every subsequent build
 * fails with a missing-module error that reads like antivirus damage. This test reproduces the exact
 * shape -- a linked directory inside the tree being removed -- and asserts the link target survives.
 */
let scratch: string | null = null

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
  scratch = null
})

test("cleaning the build directory does not delete through a symlinked package", () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "next-clean-"))
  const store = path.join(scratch, "store-package")
  const buildDir = path.join(scratch, ".next", "standalone", "node_modules")

  fs.mkdirSync(store, { recursive: true })
  fs.writeFileSync(path.join(store, "processChild.js"), "module.exports = {}")
  fs.mkdirSync(buildDir, { recursive: true })
  // "junction" is what Windows falls back to for directory links; on POSIX it is an ordinary symlink.
  fs.symlinkSync(store, path.join(buildDir, "next"), "junction")

  execFileSync(process.execPath, ["scripts/clean-next.mjs", path.join(scratch, ".next")])

  expect(fs.existsSync(path.join(scratch, ".next"))).toBe(false)
  expect(fs.existsSync(path.join(store, "processChild.js"))).toBe(true)
})
