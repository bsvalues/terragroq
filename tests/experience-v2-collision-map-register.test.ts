import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  MIN_PIN_CHARACTERS,
  PIN_REQUIRED_FROM_REGISTER,
  checkReviewRegister,
  collectSectionRefs,
  parseAnnotationRows,
  parseRegisterRows,
  parseSections,
  resolveSectionRef,
} from "@/lib/governance/review-register"

/**
 * The Experience V2 Phase 0 collision map keeps five review response registers (§10-§13, §15) whose
 * rows point into the body of the same document. Hand maintenance of that structure failed in three
 * consecutive review rounds, and round 3's structural finding was that a register pointing into a
 * body has no integrity check. This is that check, in the deterministic CI suite, so drift fails a
 * build rather than waiting for a reviewer.
 *
 * Round 4 then found five defects in the check itself (§15 rows 57-61) and three overclaims in the
 * §14 that described it. The cases below include one regression test per defect, because a
 * mechanism built to stop this document overclaiming is the last place to take a fix on trust.
 *
 * It still cannot tell whether a correction is CORRECT. §14 states the full limit list.
 */
describe("Experience V2 collision map review registers", () => {
  const mapPath = path.join(__dirname, "..", "docs/governance/williamos-experience-v2-phase0-collision-map.md")
  const map = readFileSync(mapPath, "utf8")

  it("finds every register by structure, including the one not titled 'register'", () => {
    const rows = parseRegisterRows(map)
    const registers = [...new Set(rows.map((row) => row.register))].sort((a, b) => Number(a) - Number(b))
    // §12 is titled "Revision-3 self-check". Keying register detection on the word would have
    // excluded it from every rule below without saying so.
    expect(registers).toEqual(["10", "11", "12", "13", "15"])
  })

  it("declares every register row exactly once, contiguously within its own register", () => {
    const rows = parseRegisterRows(map)
    const byRegister = new Map<string, number[]>()
    for (const row of rows) byRegister.set(row.register, [...(byRegister.get(row.register) ?? []), row.row])
    for (const [register, numbers] of byRegister) {
      expect(new Set(numbers).size, `§${register} declares a row twice`).toBe(numbers.length)
      const sorted = [...numbers].sort((a, b) => a - b)
      expect(sorted, `§${register} skips a row number`).toEqual(sorted.map((_, index) => sorted[0] + index))
    }
    // Row numbers are namespaced per register: §10 runs 1-24 and §11 restarts at 1, which is why
    // every row citation in the map is register-qualified.
    expect(byRegister.get("10")?.length).toBe(24)
    expect(byRegister.get("11")?.[0]).toBe(1)
    expect(byRegister.get("12")?.[0]).toBe(32)
    expect(byRegister.get("13")?.[0]).toBe(36)
    expect(byRegister.get("15")?.[0]).toBe(47)
  })

  it("parses annotation tables over rows that exist", () => {
    // Round 4 finding 11: §12's correction sweep was excluded for having three columns -- the one
    // table in the document whose entire subject is stale correction targets. §15's re-opening of
    // the six rows round 4 left unreviewed is the second such table.
    const annotations = parseAnnotationRows(map)
    const sweep = annotations.filter((annotation) => annotation.register === "10" && annotation.row < 25)
    expect(sweep.map((annotation) => annotation.row).sort((a, b) => a - b)).toEqual(
      expect.arrayContaining([8, 9, 11, 23, 24]),
    )
    // Every annotation must name a row that exists; checkReviewRegister enforces it, and the
    // clean-document case above is what proves none dangles.
    // §16's classification table annotates §15's rows and is five columns wide -- a row whose
    // first cell names an existing register row is an annotation whatever its width.
    expect(annotations.length).toBeGreaterThanOrEqual(29)
    expect(annotations.every((a) => ["10", "11", "15"].includes(a.register))).toBe(true)
    expect(annotations.filter((a) => a.register === "15").length).toBe(19)
  })

  it("holds the whole document clean", () => {
    expect(checkReviewRegister(map).violations).toEqual([])
  })

  it("requires a content pin on every row of §12 and later", () => {
    const report = checkReviewRegister(map)
    const late = report.rows.filter((row) => Number(row.register) >= PIN_REQUIRED_FROM_REGISTER)
    expect(late.length).toBeGreaterThan(0)
    expect(report.pinnedRows).toBe(late.length)
  })

  it("names, rather than counts, the unpinned legacy carve-out", () => {
    const report = checkReviewRegister(map)
    // Round 4 finding 15: asserting the COUNT detects a net change, not carve-out growth --
    // pinning one old row while leaving a new one unpinned keeps it at 55. Identities are asserted
    // instead, so a newly unpinned row fails even when the total does not move.
    const expected = [
      ...Array.from({ length: 24 }, (_, index) => `§10:${index + 1}`),
      ...Array.from({ length: 31 }, (_, index) => `§11:${index + 1}`),
    ]
    expect([...report.unpinnedLegacyRows].sort()).toEqual([...expected].sort())
  })

  it("fails when a register target is deleted from the body", () => {
    // §12 row 34's exact failure: §6 item 7 removed, the register still citing §6.7.
    const lines = map.split("\n")
    const start = lines.findIndex((line) => /^7\. \*\*The blanket negative revision 2 asserted here was false/.test(line))
    expect(start).toBeGreaterThan(0)
    const end = lines.findIndex((line, index) => index > start && /^## 7\./.test(line))
    const mutilated = [...lines.slice(0, start), ...lines.slice(end)].join("\n")
    const violations = checkReviewRegister(mutilated).violations
    expect(violations.some((violation) => violation.kind === "DANGLING_SECTION_REF")).toBe(true)
  })

  it("fails when a pinned target no longer carries the wording the row claims", () => {
    // §12 row 32's exact failure: invariant 13 kept saying `stale` after §4.1 withdrew the word.
    const broken = map.replace(
      "both are projected and the transport side is marked `CONFLICTING`",
      "both are projected and the transport side is marked `stale`",
    )
    expect(broken).not.toBe(map)
    expect(checkReviewRegister(broken).violations.some((v) => v.kind === "PIN_NOT_PRESENT")).toBe(true)
  })

  it("rejects a pin too generic to prove anything", () => {
    // Round 4 finding 12: `body.includes` accepted `pin: "the"`.
    const broken = map.replace('pin: "Revision 4 typed it BLOCKED_DEPENDENCY"', 'pin: "the"')
    expect(broken).not.toBe(map)
    expect(checkReviewRegister(broken).violations.some((v) => v.kind === "PIN_TOO_GENERIC")).toBe(true)
    expect(MIN_PIN_CHARACTERS).toBeGreaterThan(8)
  })

  it("matches a pin against a section's own text, not its subsections", () => {
    // Round 4 finding 12: the previous parser left every heading open until the next peer, so §7's
    // "own" text ran through §7.6 and a pin naming §7 matched anything beneath it.
    const sections = parseSections(map)
    const seven = sections.get("7")!
    // §7's own text legitimately names the reason code in its own status line; what it must NOT
    // reach is §7.6's body, two subsections down.
    expect(seven.ownText).not.toContain("the discovery sequence below")
    expect(seven.ownEndLine).toBeLessThan(seven.endLine)
    expect(sections.get("7.6")!.ownText).toContain("the discovery sequence below")
    const five = sections.get("5")!
    expect(five.ownText).not.toContain("the charter says CHOOSE")
    expect(sections.get("5.6")!.ownText).toContain("the charter says CHOOSE")
  })

  it("does not let a register certify itself through a neighbouring row", () => {
    // Round 4 finding 12: only the pinning row's own line was stripped, so a row targeting its own
    // register could match the cell beside it. Every register row is now stripped from every body.
    const rows = parseRegisterRows(map)
    const sections = parseSections(map)
    const registerLines = new Set(rows.map((row) => row.raw))
    for (const register of ["12", "13", "15"]) {
      const body = sections.get(register)!.ownText.split("\n")
      expect(body.some((line) => registerLines.has(line)), `§${register} has rows`).toBe(true)
      expect(body.filter((line) => !registerLines.has(line)).join("\n")).not.toContain("**ACCEPTED (P0)**")
    }
  })

  it("rejects a bare row citation and a malformed section token", () => {
    // Round 4 finding 13: fourteen bare row references and `§ status` were unchecked while §14
    // claimed every reference was qualified and every section reference resolved.
    const bare = map.replace("§12 row 35 is the one that failed.", "row 35 is the one that failed.")
    expect(bare).not.toBe(map)
    expect(checkReviewRegister(bare).violations.some((v) => v.kind === "BARE_ROW_REF")).toBe(true)

    const malformed = map.replace("## 16. Terminal review protocol", "## 16. See § status protocol")
    expect(malformed).not.toBe(map)
    expect(checkReviewRegister(malformed).violations.some((v) => v.kind === "MALFORMED_SECTION_REF")).toBe(true)
  })

  it("resolves both notations, including the ASCII form the fixed-width blocks use", () => {
    // The 44 ASCII references live in §8, the section with the worst record in this document, and
    // went unchecked while §14 claimed whole-document coverage.
    const sections = parseSections(map)
    const ascii = collectSectionRefs("see S7.2 and S6.6 for the assembler")
    expect(ascii.map((ref) => ref.ref)).toEqual(["7.2", "6.6"])
    expect(ascii.every((ref) => resolveSectionRef(ref, sections) !== null)).toBe(true)

    const broken = map.replace("(S6.6).", "(S6.99).")
    expect(broken).not.toBe(map)
    expect(checkReviewRegister(broken).violations.some((v) => v.kind === "DANGLING_SECTION_REF")).toBe(true)
  })

  it("resolves a list-item section reference the same way the map writes it", () => {
    // §6.7 is item 7 of §6, not a heading; §7.5 invariant 13 is item 13 inside a real heading.
    const sections = parseSections(map)
    const resolved = collectSectionRefs("§6.7 item 7 and §7.5 invariant 13").map((ref) =>
      resolveSectionRef(ref, sections),
    )
    expect(resolved.length).toBe(2)
    expect(resolved[0]?.text).toContain("scheduler")
    expect(resolved[1]?.text).toContain("CONFLICTING")
  })

  it("sees a one-row register, which the previous minimum silently hid", () => {
    // Round 4 finding 11: requiring three rows made any one- or two-finding register invisible.
    const tiny = [
      "",
      "## 16. Round-5 review response register",
      "",
      "| # | Finding | Verdict | Fixed in |",
      "| --- | --- | --- | --- |",
      '| 65 | something | **ACCEPTED (P2)** | §14 — pin: "It checks one document" |',
      "",
    ].join("\n")
    const rows = parseRegisterRows(map + tiny)
    expect(rows.some((row) => row.register === "16" && row.row === 65)).toBe(true)
  })
})
