import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  PIN_REQUIRED_FROM_REGISTER,
  checkReviewRegister,
  collectSectionRefs,
  parseRegisterRows,
  parseSections,
  resolveSectionRef,
} from "@/lib/governance/review-register"

/**
 * The Experience V2 Phase 0 collision map keeps four review response registers (§10-§13) whose rows
 * point into the body of the same document. Hand maintenance of that structure failed in three
 * consecutive review rounds -- §12 rows 32-34 and §13 rows 42, 45 are all one defect: a cell naming
 * a correction the body does not contain. Round 3's structural finding was that a register pointing
 * into a body has no integrity check. This is that check, wired into the deterministic CI suite so
 * drift fails a build rather than waiting for a fourth reviewer to find it.
 *
 * The check is deliberately narrow about what it proves. It catches deleted targets, typo'd
 * references, duplicate or skipped row numbers, dangling row cross-references, and a pinned target
 * that no longer carries the wording the row claims for it. It cannot tell whether a correction is
 * *right*. Passing is not evidence the register is honest.
 */
describe("Experience V2 collision map review registers", () => {
  const mapPath = path.join(__dirname, "..", "docs/governance/williamos-experience-v2-phase0-collision-map.md")
  const map = readFileSync(mapPath, "utf8")

  it("finds all four registers by structure, including the one not titled 'register'", () => {
    const rows = parseRegisterRows(map)
    const registers = [...new Set(rows.map((row) => row.register))].sort()
    // §12 is titled "Revision-3 self-check". Keying register detection on the word would have
    // excluded it from every rule below without saying so.
    expect(registers).toEqual(["10", "11", "12", "13"])
  })

  it("declares every register row exactly once, contiguously within its own register", () => {
    const rows = parseRegisterRows(map)
    const byRegister = new Map<string, number[]>()
    for (const row of rows) byRegister.set(row.register, [...(byRegister.get(row.register) ?? []), row.row])
    for (const [register, numbers] of byRegister) {
      expect(new Set(numbers).size, `§${register} declares a row twice`).toBe(numbers.length)
      const sorted = [...numbers].sort((a, b) => a - b)
      expect(sorted, `§${register} skips a row number`).toEqual(
        sorted.map((_, index) => sorted[0] + index),
      )
    }
    // Row numbers are namespaced per register: §10 runs 1-24 and §11 restarts at 1, which is why
    // every cross-reference in the map is written `§11 row 20` rather than `row 20`.
    expect(byRegister.get("10")?.length).toBe(24)
    expect(byRegister.get("11")?.[0]).toBe(1)
    expect(byRegister.get("12")?.[0]).toBe(32)
    expect(byRegister.get("13")?.[0]).toBe(36)
  })

  it("resolves every section reference in the document to a heading or a numbered item", () => {
    const report = checkReviewRegister(map)
    const dangling = report.violations.filter(
      (violation) => violation.kind === "DANGLING_SECTION_REF" || violation.kind === "DANGLING_ROW_REF",
    )
    expect(dangling).toEqual([])
  })

  it("keeps every register row pointing at something that exists", () => {
    const report = checkReviewRegister(map)
    expect(report.violations).toEqual([])
  })

  it("requires a content pin on every row of §12 and later", () => {
    const report = checkReviewRegister(map)
    const late = report.rows.filter((row) => Number(row.register) >= PIN_REQUIRED_FROM_REGISTER)
    expect(late.length).toBeGreaterThan(0)
    expect(report.pinnedRows).toBe(late.length)
    expect(report.violations.filter((violation) => violation.kind === "MISSING_PIN")).toEqual([])
  })

  it("records, rather than assumes, how much of the register is unpinned legacy", () => {
    const report = checkReviewRegister(map)
    // §10 and §11 predate the pin mechanism. The number is asserted so the carve-out cannot grow
    // quietly; a new unpinned legacy row has to be argued for in a diff.
    expect(report.unpinnedLegacyRows).toBe(55)
  })

  it("fails when a register target is deleted from the body", () => {
    // Row 34's exact failure: §6 item 7 removed, the register still citing §6.7.
    const lines = map.split("\n")
    const start = lines.findIndex((line) => /^7\. \*\*The blanket negative/.test(line))
    expect(start).toBeGreaterThan(0)
    const end = lines.findIndex((line, index) => index > start && /^## 7\./.test(line))
    const mutilated = [...lines.slice(0, start), ...lines.slice(end)].join("\n")
    const violations = checkReviewRegister(mutilated).violations
    expect(violations.some((violation) => violation.kind === "DANGLING_SECTION_REF")).toBe(true)
  })

  it("fails when a pinned target no longer carries the wording the row claims", () => {
    // Row 32's exact failure: invariant 13 kept saying `stale` after §4.1 withdrew the word.
    const broken = map.replace(
      "both are projected and the transport side is marked `CONFLICTING`",
      "both are projected and the transport side is marked `stale`",
    )
    expect(broken).not.toBe(map)
    const violations = checkReviewRegister(broken).violations
    expect(violations.some((violation) => violation.kind === "PIN_NOT_PRESENT")).toBe(true)
  })

  it("resolves a list-item section reference the same way the map writes it", () => {
    // §6.7 is item 7 of §6, not a heading; §7.5 invariant 13 is item 13 inside a real heading.
    // Both forms appear in the registers, so both have to resolve or the check is decorative.
    const sections = parseSections(map)
    const resolved = collectSectionRefs("§6.7 item 7 and §7.5 invariant 13").map((ref) =>
      resolveSectionRef(ref, sections),
    )
    expect(resolved.length).toBe(2)
    expect(resolved[0]?.text).toContain("scheduler")
    expect(resolved[1]?.text).toContain("CONFLICTING")
  })
})
