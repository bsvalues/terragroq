import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The capabilities the six deleted routes could exercise and the environment cannot reach yet.
 *
 * Companion to `tests/decision-register-write-gap.test.ts`, which pins the governed WRITES that lost
 * their surface. This pins the READS and behaviours, found by the independent codex assurance review
 * of PR #1011 and confirmed by execution.
 *
 * Two failure modes, the same two that ledger pins. Delete one of these capabilities instead of
 * replacing it and the build fails, because the ledger says it is recoverable. Give one of them a
 * door without moving its row out of the ledger and the build fails too — a ledger nobody checks is
 * exactly how the first of these gaps survived a green suite.
 */

const ROOT = process.cwd()
const LEDGER = "docs/product/deleted-route-capability-gaps.md"

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf8")
}

/** Every source file that could plausibly hold a door. Tests are not doors. */
function productSources(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue
        walk(relative)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        found.push(relative)
      }
    }
  }
  for (const root of ["app", "components", "lib"]) walk(root)
  return found
}

const SOURCES = productSources().map((file) => ({ file, text: read(file) }))

/** Files that reference a symbol, excluding the file that defines it. */
function callers(symbol: string, definedIn: string): string[] {
  return SOURCES.filter(({ file, text }) => file !== definedIn && text.includes(symbol)).map((s) => s.file)
}

describe("the ledger names every gap it claims to name", () => {
  const ledger = read(LEDGER)

  it("is open, typed and enforced", () => {
    expect(ledger).toContain("OPEN, TYPED, ENFORCED")
  })

  it.each([
    "app/api/chat/route.ts",
    "components/trace/trace-ledger-registry.ts",
    "lib/workbench/execution-projection.ts",
    "lib/workbench/load-threads.ts",
    "components/desk/desk.tsx",
    "app/actions/work-orders.ts",
    "lib/workbench/outcome-execution-authorization.ts",
  ])("names %s", (subject) => {
    expect(ledger.includes(subject), `${subject} is enforced here but absent from ${LEDGER}`).toBe(true)
  })
})

describe("1. /chat's governed retrieval is alive and has no door", () => {
  const route = "app/api/chat/route.ts"

  it("keeps the retrieval and the citation contract alive, so the capability is recoverable", () => {
    const text = read(route)
    for (const read_ of ["getActiveDoctrine", "getActiveDecisions", "searchMemory", "searchCorpus"]) {
      expect(text.includes(read_), `${read_} was deleted rather than replaced; ${LEDGER} says it is alive`).toBe(true)
    }
    expect(text).toContain("Cite every claim drawn from context")
    expect(text).toContain("sources")
  })

  it("still has no caller in the product", () => {
    // `app/api/loom/agent/route.ts` fetches `${LOCAL_ENDPOINT}/api/chat` — the upstream inference
    // server's endpoint, not this route — so it is not a door and is excluded deliberately.
    const doors = SOURCES.filter(
      ({ file, text }) =>
        file !== route && text.includes('"/api/chat"') && !file.startsWith("app/api/loom/"),
    ).map((s) => s.file)
    expect(
      doors,
      `/api/chat now HAS a door (${doors.join(", ")}) — good. Move its section out of ${LEDGER} and ` +
        `out of this file, so the ledger stops understating the product.`,
    ).toEqual([])
  })
})

describe("2. the static Trace Ledger is alive and has no door", () => {
  const registry = "components/trace/trace-ledger-registry.ts"

  it("keeps the surface reader alive", () => {
    expect(read(registry)).toContain("export function getTraceLedgerSurface")
  })

  it("still has no caller in the product", () => {
    const doors = callers("getTraceLedgerSurface", registry)
    expect(
      doors,
      `getTraceLedgerSurface now HAS a door (${doors.join(", ")}). Move its section out of ${LEDGER}.`,
    ).toEqual([])
  })

  it("keeps the navigation entries that still advertise the address, so the mislabelling is visible", () => {
    // These are wrong TODAY: they describe the static ledger and the address now reaches the runtime
    // half. Deleting them would hide the gap rather than close it.
    for (const registryFile of [
      "components/academy/academy-wiki-registry.ts",
      "components/agent-forge/agent-forge-surface.ts",
      "components/hermes/hermes-boundary-registry.ts",
      "components/brain-council/council-advisory-surface.ts",
      "components/operator/codex-operator-surface.ts",
    ]) {
      expect(read(registryFile)).toContain('"/trace"')
    }
  })
})

describe("3. exact durable-record addressing is minted and discarded", () => {
  it("still mints EXACT deep links carrying a reference", () => {
    for (const file of ["lib/workbench/execution-projection.ts", "lib/workbench/load-threads.ts"]) {
      expect(read(file), `${file} stopped minting /trace deep links`).toContain("/trace?trace=")
    }
  })

  it("has nothing at the root that reads the reference those links carry", () => {
    // The redirect preserves it — `/trace?trace=X` -> `/?trace=X&summon=runtime-trace`, probed
    // against the standalone build — so a reader at `/` is all that is missing. If one appears, this
    // gap is closed and its section must leave the ledger.
    const rootPage = read("app/page.tsx")
    const desk = read("components/desk/desk.tsx")
    const reads = rootPage.includes("trace") && /searchParams[\s\S]{0,400}\btrace\b/.test(rootPage)
    expect(
      reads || desk.includes("initialTraceReference"),
      `the root now reads a durable trace reference — good. Move section 3 out of ${LEDGER}.`,
    ).toBe(false)
  })
})

describe("5. the work-order release gates and closure result are alive and doorless", () => {
  const actions = "app/actions/work-orders.ts"

  /** Deleted with /work-orders and restored on this branch. Doorless is a gap; deleted is a loss. */
  const RESTORED = ["setWorkOrderGate", "recordWorkOrderResult", "deleteWorkOrder"] as const

  /** Never deleted, and still doorless. */
  const UNREPLACED = ["updateWorkOrderContract", "linkWorkOrderEvidence", "getClosureReport"] as const

  it("keeps every restored action alive, so the capability is recoverable", () => {
    const text = read(actions)
    for (const write of RESTORED) {
      expect(
        text.includes(`export async function ${write}`),
        `${write} was deleted again. ${LEDGER} records it as restored-but-doorless: a gate nobody ` +
          `can open is not a missing surface, it is a governance control that stopped existing.`,
      ).toBe(true)
    }
  })

  it("does not restore a revalidatePath for a route that no longer exists", () => {
    // Asserted on the import rather than on the string, so the ledger comment in the file that
    // EXPLAINS the omission does not read as the thing it warns about.
    expect(read(actions)).not.toContain('from "next/cache"')
  })

  it("proves the gates are live governance inputs and not page state", () => {
    // This is why deleting the writer mattered: the columns are read by the delivery authority
    // contract and printed by the lifecycle report. If these readers ever go, the gap changes shape
    // and this ledger owes an explanation.
    expect(read("lib/workbench/outcome-execution-authorization.ts")).toContain("commitAllowed")
    expect(read("lib/work-orders/lifecycle.ts")).toContain("commitAllowed")
  })

  it("still has no door for any of them", () => {
    for (const write of [...RESTORED, ...UNREPLACED]) {
      const doors = callers(write, actions)
      expect(
        doors,
        `${write} now HAS a door (${doors.join(", ")}) — good. Move its row out of ${LEDGER}.`,
      ).toEqual([])
    }
  })
})

describe("4. the world is persisted and not restored", () => {
  const desk = read("components/desk/desk.tsx")

  it("still persists every world, so restoration remains buildable", () => {
    const route = read("app/api/environment/line/route.ts")
    expect(route).toContain("async function loadWorld")
    expect(route).toContain("async function saveWorld")
    expect(route).toContain("validateWorkingWorld")
  })

  it("still arrives with the new-world sentinel rather than a restored id", () => {
    // The whole gap in one line: the client has no durable place to keep `worldId`, so it asks for a
    // new world on every arrival. When that changes, section 4 leaves the ledger.
    expect(desk).toContain('body: JSON.stringify({ worldId: null, summon: initialSummon })')
  })

  it("does not claim a restoration it does not perform", () => {
    // The route once said the world "keeps the surface so a reload does not lose it". The snapshot
    // does keep it; the operator never gets back to that snapshot. A comment that reads as a promise
    // is how the next lane concludes the capability is already there.
    const route = read("app/api/environment/line/route.ts")
    expect(route).not.toContain("so a reload does not lose it")
  })
})
