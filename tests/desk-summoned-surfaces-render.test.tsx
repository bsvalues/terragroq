// @vitest-environment jsdom
import fs from "node:fs"
import path from "node:path"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Desk } from "@/components/desk/desk"
import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { SUMMONED_SURFACES } from "@/lib/environment/summon"

/**
 * A surface that is summoned and never DRAWN.
 *
 * `work-orders` was in the Surface union, in the route's summon catalogue, and on the far end of a
 * permanent `/work-orders` redirect. It had no renderer. TypeScript was satisfied — the union member
 * existed — and the suite was green, because every test asserted the surface was *produced*, and none
 * asserted it was *readable*. The `<pre>` at the bottom of `SurfaceView` caught the fall-through and
 * painted `[object Object],[object Object]` at the owner: the address survived the deletion and the
 * capability did not, which is the precise failure this landing exists to prevent.
 *
 * Three independent assurance lanes found it by reading. These make it cost something.
 */

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

const ROOT = process.cwd()
const SURFACE_RENDERER = fs.readFileSync(path.join(ROOT, "components/workspace-shell/inspector-surface.tsx"), "utf8")

/** Arrive by ADDRESS, the way a superseded route's redirect does, with the Line stubbed. */
async function arrive(summon: (typeof SUMMONED_SURFACES)[number], surface: unknown) {
  const initialSpace = spaceToServer(defaultSpace(1440, 900, "w-1", "Test Space"))
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      if (url === "/api/environment/space" && method === "GET") {
        return Response.json({ worldId: "w-1", space: initialSpace })
      }
      if (url === "/api/environment/space" && method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { space: unknown }
        return Response.json({ worldId: "w-1", space: body.space, updatedAt: "2026-08-30T00:00:00.000Z" })
      }
      if (url === "/api/environment/line" && method === "POST") {
        return Response.json({ worldId: "w-1", say: "here it is", surfaces: [surface] })
      }
      if (url === "/api/environment/space/outcome" && method === "POST") {
        return Response.json({ error: "NO_ACTIVE_OUTCOME" }, { status: 409 })
      }
      if (url === "/api/environment/judgment" && method === "POST") {
        return Response.json({ error: "JUDGMENT_UNAVAILABLE" }, { status: 503 })
      }
      if (url === "/api/loom/files?path=" && method === "GET") {
        return Response.json({ kind: "directory", entries: [] })
      }
      throw new Error(`unexpected request: ${method} ${url}`)
    }),
  )
  render(<Desk initialSummon={summon} />)
  await waitFor(() => expect(document.body.textContent).toContain("here it is"))
}

describe("every summonable surface can actually be drawn", () => {
  it.each(SUMMONED_SURFACES)("has a renderer branch for %s", (kind) => {
    // Structural, so the NEXT surface added to the catalogue cannot repeat this. A member that only
    // exists in the union reaches the source/tests `<pre>` and stringifies whatever it was given.
    expect(
      SURFACE_RENDERER.includes(`surface.kind === "${kind}"`),
      `"${kind}" is summonable but SurfaceView has no branch for it, so it falls through to the ` +
        `<pre> fallback and renders as stringified objects. Add the branch, not the union member.`,
    ).toBe(true)
  })
})

describe("the work-orders surface shows work orders", () => {
  it("renders the records rather than stringifying them", async () => {
    await arrive("work-orders", {
      kind: "work-orders",
      subject: "work orders",
      payload: [
        { ref: "WO-0142", title: "the journey driver verifies TLS", status: "completed", agent: "claude", phase: "P3" },
        { ref: "WO-0143", title: "the register stops lying", status: "in_progress", agent: null, phase: null },
      ],
    })

    expect(screen.getByText("WO-0142")).toBeTruthy()
    expect(screen.getByText("the journey driver verifies TLS")).toBeTruthy()
    expect(screen.getByText("WO-0143")).toBeTruthy()
    // The exact shape of the failure, pinned: object coercion is what the owner saw.
    expect(document.body.textContent).not.toContain("[object Object]")
  })

  it("says the register is empty instead of drawing an empty box", async () => {
    await arrive("work-orders", { kind: "work-orders", subject: "work orders", payload: [] })
    expect(screen.getByText("No work orders exist yet.")).toBeTruthy()
  })
})

describe("the activity surface keeps its chronology and its references", () => {
  it("draws the event time and the governed ref that were already on the wire", async () => {
    await arrive("activity", {
      kind: "activity",
      subject: "governed activity",
      payload: [
        { at: "2026-08-25T14:31:00.000Z", kind: "delivery", label: "PR #1011 opened", detail: null, ref: "WO-0142" },
      ],
    })

    // A feed without a clock answers "what happened" but not "when"; without a ref it cannot be tied
    // back to the work it belongs to. Both fields were carried and neither was painted.
    expect(screen.getByText("08-25 14:31")).toBeTruthy()
    expect(screen.getByText("WO-0142")).toBeTruthy()
  })

  it("does not render an unparseable timestamp as Invalid Date", async () => {
    await arrive("activity", {
      kind: "activity",
      subject: "governed activity",
      payload: [{ at: "not-a-time", kind: "authority", label: "grant checked", detail: null, ref: null }],
    })
    expect(document.body.textContent).not.toContain("Invalid Date")
  })
})

describe("the decision register shows whether a decision was actually accepted", () => {
  it("draws status, so a proposal is not mistaken for a decision", async () => {
    await arrive("decisions", {
      kind: "decisions",
      subject: "decision register",
      payload: [
        { ref: "ADR-0007", title: "the claude lane is the fallback", decision: "APPROVE", status: "proposed", authority: "advisory", supersededById: null },
      ],
    })

    // The Line records as PROPOSED. A register that renders a proposal identically to an accepted
    // decision is the register claiming an authority nobody granted it.
    expect(screen.getByText("proposed")).toBeTruthy()
    expect(screen.getByText("ADR-0007")).toBeTruthy()
  })
})
