import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Owner resolution must exist in exactly one place.
 *
 * It did not. Sign-in by device certificate, device credential management and governance authority
 * each decided who the owner was, by rules that happened to agree. Nothing made them agree, and the
 * failure they permit is quiet: an operator holding write authority while being refused management of
 * his own devices, with no error naming the contradiction.
 *
 * Grepping for the queries is blunt, and that is the point -- it fails when someone adds a second
 * copy, which is the only moment worth catching.
 */
describe("one source of owner resolution", () => {
  const repoRoot = path.join(__dirname, "..")
  const canonical = "lib/governance/owner-lookup.ts"

  // Both halves of the rule: who the configured owner is, and who the only real account is.
  const signatures = ['lower("email")', "\"providerId\" = 'credential'"]

  const searched = [
    "app/api/device-cert/session/route.ts",
    "app/api/governance/workroom-authority/route.ts",
    canonical,
  ]

  for (const signature of signatures) {
    it(`only ${canonical} carries: ${signature}`, () => {
      const carriers = searched.filter((relative) =>
        readFileSync(path.join(repoRoot, relative), "utf8").includes(signature),
      )
      expect(carriers).toEqual([canonical])
    })
  }

  it("the callers resolve through the shared rule rather than their own query", () => {
    for (const relative of searched.filter((file) => file !== canonical)) {
      const source = readFileSync(path.join(repoRoot, relative), "utf8")
      expect(source).toContain("resolveOwnerUserId")
      expect(source).toContain("ownerLookup()")
    }
  })
})
