import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, it } from "vitest"

import { applyGovernedMarkerChange } from "@/scripts/hello-application/apply-governed-marker-change.mjs"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

it("recognizes the committed governed marker baseline as idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-marker-baseline-"))
  roots.push(root)
  fs.cpSync(path.join(process.cwd(), "examples", "hello-application"), path.join(root, "examples", "hello-application"), { recursive: true })

  expect(applyGovernedMarkerChange({ repositoryRoot: root }).changedPaths).toEqual([])
})
