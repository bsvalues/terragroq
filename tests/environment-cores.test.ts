import { describe, expect, it } from "vitest"

import { resolveAmbiguity } from "@/lib/environment/assumption-policy"
import {
  createWorkingWorld,
  validateWorkingWorld,
  withSurface,
  withTurn,
} from "@/lib/environment/working-world"

/**
 * S1 and S6 are the first two architecture requirements of the Environment (#762), and both encode an
 * owner rule as refusable logic: the assumption triad so a model change cannot revive the
 * interrogation machine, and the meaning-only snapshot so chrome can never colonize restoration.
 */
describe("S1 — the assumption triad", () => {
  const candidates = [
    { id: "terrafusion", label: "TerraFusion's login", weight: 2 },
    { id: "williamos", label: "the WilliamOS operator sign-in", weight: 1 },
  ]

  it("assumes and states when a wrong guess is cheap, picking the weightier candidate", () => {
    const decision = resolveAmbiguity({ subject: "which login flow", candidates, costOfWrongGuess: "cheap" })
    expect(decision.mode).toBe("ASSUME_AND_STATE")
    if (decision.mode === "ASSUME_AND_STATE") {
      expect(decision.chosen.id).toBe("terrafusion")
      // The statement always names the assumption and the exit. This exact shape is the norm.
      expect(decision.statement).toBe("Taking this as TerraFusion's login — one word corrects me.")
    }
  })

  it("asks when the wrong guess is expensive, and says why", () => {
    const decision = resolveAmbiguity({ subject: "which database to migrate", candidates, costOfWrongGuess: "expensive" })
    expect(decision.mode).toBe("ASK")
    if (decision.mode === "ASK") expect(decision.question).toContain("isn't cheap to undo")
  })

  it("asks when the guess is irreversible, however obvious the candidate", () => {
    const one = [{ id: "only", label: "the only candidate", weight: 9 }]
    expect(resolveAmbiguity({ subject: "what to delete", candidates: one, costOfWrongGuess: "irreversible" }).mode).toBe("ASK")
  })

  it("never assumes across an authority boundary, even a cheap one", () => {
    const decision = resolveAmbiguity({
      subject: "which policy applies",
      candidates,
      costOfWrongGuess: "cheap",
      authorityBoundary: true,
    })
    expect(decision.mode).toBe("ASK")
  })

  it("asks honestly when there is nothing to assume, instead of inventing a candidate", () => {
    const decision = resolveAmbiguity({ subject: "which service", candidates: [], costOfWrongGuess: "cheap" })
    expect(decision.mode).toBe("ASK")
    if (decision.mode === "ASK") expect(decision.candidates).toHaveLength(0)
  })

  it("breaks ties toward the first listed candidate, so ordering is meaningful", () => {
    const tied = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]
    const decision = resolveAmbiguity({ subject: "which one", candidates: tied, costOfWrongGuess: "cheap" })
    if (decision.mode === "ASSUME_AND_STATE") expect(decision.chosen.id).toBe("a")
  })
})

describe("S6 — the snapshot holds meaning and refuses chrome", () => {
  it("creates a world from intent alone — no ceremony fields exist to fill in", () => {
    const world = createWorkingWorld({ intent: "fix the login flow", resources: ["bsvalues/terragroq"] })
    expect(world.intent).toBe("fix the login flow")
    expect(world.continuation).toBe("active")
    expect(validateWorkingWorld(world)).toBeTruthy()
  })

  it("refuses a world with no intent, because a world IS the named work", () => {
    expect(() => createWorkingWorld({ intent: "   " })).toThrow("WORLD_NEEDS_INTENT")
  })

  it("refuses chrome-shaped keys anywhere in the structure", () => {
    const world = createWorkingWorld({ intent: "x" }) as unknown as Record<string, unknown>
    const polluted = { ...world, surfaces: [{ kind: "editor", subject: "a.ts", paneWidth: 318 }] }
    expect(() => validateWorkingWorld(polluted)).toThrow(/WORLD_CHROME_REFUSED/)
  })

  it("refuses unknown top-level keys rather than carrying them silently", () => {
    const world = createWorkingWorld({ intent: "x" }) as unknown as Record<string, unknown>
    expect(() => validateWorkingWorld({ ...world, layoutRects: [] })).toThrow(/WORLD_UNKNOWN_KEY|WORLD_CHROME_REFUSED/)
  })

  it("keeps conversational position bounded and ordered", () => {
    let world = createWorkingWorld({ intent: "x" })
    for (let index = 0; index < 50; index += 1) {
      world = withTurn(world, index % 2 === 0 ? "owner" : "williamos", `turn ${index}`, () => `t${index}`)
    }
    expect(world.conversation).toHaveLength(40)
    expect(world.conversation[39].content).toBe("turn 49")
  })

  it("records surfaces by meaning, unique per kind and subject", () => {
    let world = createWorkingWorld({ intent: "x" })
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "reproducing the failure" })
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "rerunning after the fix" })
    expect(world.surfaces).toHaveLength(1)
    expect(world.surfaces[0].because).toBe("rerunning after the fix")
  })

  it("round-trips the owner-authorized durable Space without weakening legacy world validation", () => {
    const legacy = createWorkingWorld({ intent: "TerraFusion", resources: ["bsvalues/terragroq"] })
    expect(validateWorkingWorld(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy)

    const persisted = {
      ...legacy,
      space: {
        schemaVersion: 1,
        revision: 1,
        windows: [
          {
            id: "editor-main",
            kind: "editor",
            title: "Source",
            frame: { x: 48, y: 36, width: 920, height: 700 },
            z: 2,
            minimized: false,
          },
          {
            id: "running-app",
            kind: "running-app",
            title: "TerraFusion",
            frame: { x: 840, y: 80, width: 860, height: 640 },
            z: 1,
            minimized: true,
          },
        ],
        openFiles: ["src/search-ranking.ts", "src/query.ts"],
        panes: [
          { id: "left", filePath: "src/search-ranking.ts" },
          { id: "right", filePath: "src/query.ts" },
        ],
        selection: { filePath: "src/query.ts", anchor: 14, head: 27 },
        activeWindowId: "editor-main",
        activePaneId: "right",
        runningAppUrl: "https://terrafusion.local.test/",
      },
    }

    expect(validateWorkingWorld(JSON.parse(JSON.stringify(persisted))).space).toEqual(persisted.space)
  })

  it("round-trips only a bounded path-bound Review Inspector payload", () => {
    const world = createWorkingWorld({ intent: "Review TerraFusion source" })
    const reviewWindow = {
      id: "review-src-app",
      kind: "inspector",
      title: "Review report",
      frame: { x: 100, y: 90, width: 560, height: 480 },
      z: 4,
      minimized: false,
      surfaceKind: "review",
      surfaceSubject: "src/app.ts",
      surfacePayload: "P1: authorization can be bypassed",
    }
    const space = {
      schemaVersion: 1,
      revision: 1,
      windows: [reviewWindow],
      openFiles: ["src/app.ts"],
      panes: [{ id: "left", filePath: "src/app.ts" }],
      selection: null,
      activeWindowId: reviewWindow.id,
      activePaneId: "left",
      runningAppUrl: null,
    }

    expect(validateWorkingWorld({ ...world, space }).space?.windows).toEqual([reviewWindow])
    expect(() => validateWorkingWorld({
      ...world,
      space: {
        ...space,
        windows: [{ ...reviewWindow, surfacePayload: "x".repeat(200_001) }],
      },
    })).toThrow(/SPACE_REVIEW_PAYLOAD_INVALID/)
  })

  it("refuses malformed durable Space geometry instead of treating layout as arbitrary JSON", () => {
    const world = createWorkingWorld({ intent: "TerraFusion" })
    expect(() => validateWorkingWorld({
      ...world,
      space: {
        schemaVersion: 1,
        revision: 1,
        windows: [{
          id: "editor-main",
          kind: "editor",
          title: "Source",
          frame: { x: 0, y: 0, width: -1, height: 700 },
          z: 1,
          minimized: false,
        }],
        openFiles: [],
        panes: [],
        selection: null,
        activeWindowId: "editor-main",
        activePaneId: null,
        runningAppUrl: null,
      },
    })).toThrow(/SPACE_WINDOW_FRAME_INVALID/)
  })

  it("normalizes safe workspace paths and keeps panes and selection coherent with open files", () => {
    const world = createWorkingWorld({ intent: "TerraFusion" })
    const validated = validateWorkingWorld({
      ...world,
      space: {
        schemaVersion: 1,
        revision: 1,
        windows: [{ id: "editor", kind: "editor", title: "Source", frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false }],
        openFiles: ["./src\\a.ts"],
        panes: [{ id: "main", filePath: "src/a.ts" }],
        selection: { filePath: "src\\a.ts", anchor: 2, head: 5 },
        activeWindowId: "editor",
        activePaneId: "main",
        runningAppUrl: null,
      },
    })
    expect(validated.space?.openFiles).toEqual(["src/a.ts"])
    expect(validated.space?.panes[0].filePath).toBe("src/a.ts")
    expect(validated.space?.selection?.filePath).toBe("src/a.ts")
  })

  it("refuses escaping, unopened pane files and selection outside the active file", () => {
    const base = {
      schemaVersion: 1,
      revision: 1,
      windows: [{ id: "editor", kind: "editor", title: "Source", frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false }],
      openFiles: ["src/a.ts"],
      panes: [{ id: "main", filePath: "src/a.ts" }],
      selection: { filePath: "src/a.ts", anchor: 0, head: 0 },
      activeWindowId: "editor",
      activePaneId: "main",
      runningAppUrl: null,
    }
    const world = createWorkingWorld({ intent: "TerraFusion" })
    expect(() => validateWorkingWorld({ ...world, space: { ...base, openFiles: ["../secret"] } }))
      .toThrow(/SPACE_FILE_PATH_INVALID/)
    expect(() => validateWorkingWorld({ ...world, space: { ...base, panes: [{ id: "main", filePath: "src/b.ts" }] } }))
      .toThrow(/SPACE_PANE_FILE_NOT_OPEN/)
    expect(() => validateWorkingWorld({ ...world, space: { ...base, openFiles: ["src/a.ts", "src/b.ts"], selection: { filePath: "src/b.ts", anchor: 0, head: 0 } } }))
      .toThrow(/SPACE_SELECTION_NOT_ACTIVE/)
  })

  it("round-trips reconstructable Inspector identity from the canonical summoned-surface catalogue", () => {
    const world = createWorkingWorld({ intent: "TerraFusion" })
    const validated = validateWorkingWorld({
      ...world,
      space: {
        schemaVersion: 1,
        revision: 1,
        windows: [{
          id: "inspector", kind: "inspector", title: "Evidence",
          frame: { x: 900, y: 60, width: 420, height: 600 }, z: 3, minimized: false,
          surfaceKind: "evidence", surfaceSubject: "audit:1042",
        }],
        openFiles: [], panes: [], selection: null,
        activeWindowId: "inspector", activePaneId: null, runningAppUrl: null,
      },
    })
    expect(validated.space?.windows[0]).toMatchObject({
      kind: "inspector", surfaceKind: "evidence", surfaceSubject: "audit:1042",
    })
  })

  it("requires canonical bounded identity only on Inspector windows", () => {
    const base = {
      id: "inspector", kind: "inspector", title: "Evidence",
      frame: { x: 900, y: 60, width: 420, height: 600 }, z: 3, minimized: false,
    }
    const wrap = (window: Record<string, unknown>) => ({
      ...createWorkingWorld({ intent: "TerraFusion" }),
      space: {
        schemaVersion: 1, revision: 1, windows: [window], openFiles: [], panes: [], selection: null,
        activeWindowId: window.id, activePaneId: null, runningAppUrl: null,
      },
    })
    expect(() => validateWorkingWorld(wrap(base))).toThrow(/SPACE_INSPECTOR_IDENTITY_REQUIRED/)
    expect(() => validateWorkingWorld(wrap({ ...base, surfaceKind: "made-up", surfaceSubject: "x" })))
      .toThrow(/SPACE_INSPECTOR_SURFACE_KIND_INVALID/)
    expect(() => validateWorkingWorld(wrap({ ...base, surfaceKind: "evidence", surfaceSubject: "x".repeat(1001) })))
      .toThrow(/SPACE_INSPECTOR_SURFACE_SUBJECT_INVALID/)
    expect(() => validateWorkingWorld(wrap({ ...base, kind: "editor", surfaceKind: "evidence", surfaceSubject: "audit:1" })))
      .toThrow(/SPACE_CORE_WINDOW_IDENTITY_FORBIDDEN/)
  })
})
