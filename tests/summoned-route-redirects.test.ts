import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import nextConfig from "@/next.config"
import { SUMMONED_SURFACES, classifySummon, isSummonedSurface } from "@/lib/environment/summon"

const ROOT = process.cwd()

/**
 * A deleted page must not become a dead address.
 *
 * The primary experience replacement deleted six legacy routes and collapsed two predecessor
 * environment roots. That is the right change and the owner ordered it — but ninety-three links in
 * thirty-five surviving files still name those addresses, and nothing in the branch asserted that
 * following one of them still reached the capability. A green suite proved the pages were gone; it
 * proved nothing about what an operator gets when they click.
 *
 * "Migrated" has to mean the capability survives the move. These tests are what makes that claim
 * checkable: every removed address redirects, every redirect names a surface the environment can
 * actually summon, and no removed address quietly grows a page again.
 */

/** What this change removed, and what an operator asking for that address is really asking to see. */
const SUPERSEDED_ROUTES = {
  "/work-orders": "work-orders",
  "/decisions": "decisions",
  "/trace": "runtime-trace",
  "/activity": "activity",
  "/projects": "project",
  // No surface: the Line replaced chat outright. Chat is not something you open here.
  "/chat": null,
  // The two predecessor compositions (#919, #922). Collapsed, not kept beside the real one.
  "/env": null,
  "/environment": null,
} as const

async function redirects() {
  const configured = await nextConfig.redirects?.()
  return configured ?? []
}

describe("every superseded route still reaches the environment", () => {
  it("redirects all of them, permanently", async () => {
    const configured = await redirects()
    for (const route of Object.keys(SUPERSEDED_ROUTES)) {
      const rule = configured.find((entry) => entry.source === route)
      expect(rule, `${route} was deleted with no redirect — it is a 404`).toBeDefined()
      // Permanent, because these addresses are not coming back: a 307 would tell every crawler and
      // every browser cache that the old shape might return.
      expect(rule?.permanent, `${route} must redirect permanently`).toBe(true)
    }
  })

  it("carries the surface the deleted page used to be, and never invents one", async () => {
    const configured = await redirects()
    for (const [route, surface] of Object.entries(SUPERSEDED_ROUTES)) {
      const destination = configured.find((entry) => entry.source === route)?.destination ?? ""
      if (surface === null) {
        expect(destination, `${route} carries no surface`).toBe("/")
        continue
      }
      expect(destination).toBe(`/?summon=${surface}`)
      // The surface named in a URL has to be one the environment can actually materialize. This is
      // the seam that rots silently: rename a surface in the union and the redirect keeps pointing
      // at a name nothing answers to, landing the owner on an empty screen with no error.
      expect(isSummonedSurface(surface), `${surface} is not a summonable surface`).toBe(true)
    }
  })

  it("does not leave a page behind at any superseded address", () => {
    for (const route of Object.keys(SUPERSEDED_ROUTES)) {
      const segment = route.slice(1)
      for (const candidate of [`app/${segment}/page.tsx`, `app/(shell)/${segment}/page.tsx`]) {
        expect(
          fs.existsSync(path.join(ROOT, candidate)),
          `${candidate} exists, so the redirect is shadowed and the deletion did not happen`,
        ).toBe(false)
      }
    }
  })

  it("reaches the same surfaces by sentence that it reaches by address", () => {
    // Two doors, one room. If an address can summon a surface that no sentence can, the environment
    // has grown a navigation model beside the Line rather than behind it.
    const byAddress = Object.values(SUPERSEDED_ROUTES).filter((surface) => surface !== null)
    for (const surface of byAddress) {
      const spoken = SPOKEN_REQUESTS[surface]
      expect(classifySummon(spoken), `"${spoken}" should summon ${surface}`).toBe(surface)
    }
  })

  it("keeps the environment collapsed to one root", () => {
    for (const predecessor of ["app/env/page.tsx", "app/environment/page.tsx", "components/environment/environment.tsx", "app/api/env/line/route.ts"]) {
      expect(
        fs.existsSync(path.join(ROOT, predecessor)),
        `${predecessor} is a predecessor composition — three shells is the failure the collision map named`,
      ).toBe(false)
    }
    expect(fs.existsSync(path.join(ROOT, "app/page.tsx"))).toBe(true)
  })
})

/** The way an owner would ask out loud for each surface an address can reach. */
const SPOKEN_REQUESTS: Record<string, string> = {
  "work-orders": "show me the work orders",
  decisions: "show me the decisions",
  "runtime-trace": "show me the trace",
  activity: "show me the activity",
  project: "show me the projects",
}

describe("a summon works as the first thing said, not only inside an existing world", () => {
  const route = fs.readFileSync(path.join(ROOT, "app/api/environment/line/route.ts"), "utf8")

  it("consults the summon classifier on the new-world path too", () => {
    // The bug this pins: `classifySummon` was reached only under `if (requestedWorldId)`, so the
    // first sentence after a cold load — the single most common request there is — answered "show me
    // the work orders" with model prose instead of the work orders. Two call sites, deliberately.
    const callSites = [...route.matchAll(/classifySummon\(/g)].length
    expect(callSites).toBeGreaterThanOrEqual(2)
  })

  it("decides to summon before falling through to conversation", () => {
    // Order is the whole property. `converse` is the last resort; a summon that lands after it is a
    // summon that never happens.
    const decision = route.lastIndexOf("const firstSummon = classifySummon(text)")
    const fallthrough = route.lastIndexOf("await converse(")
    expect(decision).toBeGreaterThan(-1)
    expect(fallthrough).toBeGreaterThan(decision)
  })

  it("validates an addressed summon against the catalogue instead of trusting the body", () => {
    expect(route).toContain("isSummonedSurface(body.summon)")
  })
})

describe("the surface catalogue is enumerable, so nothing can drop out of it silently", () => {
  it("lists every surface the Line route can materialize", () => {
    const route = fs.readFileSync(path.join(ROOT, "app/api/environment/line/route.ts"), "utf8")
    for (const surface of SUMMONED_SURFACES) {
      expect(route, `${surface} is in the union but the route never builds it`).toContain(`"${surface}"`)
    }
  })
})
