import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CONTROL_CENTER_FENCE,
  DESTINATIONS,
  MUTATION_UNAVAILABLE,
  SIGNALS,
  objectActionRegistry,
  resolveObjectAction,
  resolveObjectMutation,
} from "@/lib/intent/object-action-registry"
import { routeUniversalIntent } from "@/lib/intent/router"
import {
  findWorkbenchActions,
  matchWorkbenchNavigationTarget,
  workbenchActionRegistry,
} from "@/lib/intent/workbench-action-registry"
import { readNodeIdentityContract } from "@/lib/system/node-identity-contract"
import { projectSystemObjects, type InventoryNode, type NodeObject } from "@/lib/system/system-object"

/**
 * Gate 2 acceptance: #995's invariants, minus the three that follow the chosen action.
 *
 * Invariants 9, 12 and 13 cannot be delivered by this gate and saying so is the point rather than an
 * excuse. The bounded search this gate had to run FIRST found no existing canonical action that
 * satisfies the charter's intrinsic criteria, and building one is a charter amendment under recorded
 * authority -- not a finding a builder lane may act on. So there is no chosen action to test against
 * eleven criteria (9), no chosen action whose evidence records an observed post-state (12), and no
 * governed-execution leg for the end-to-end journey (13). What IS asserted below is that the absence
 * is typed, reasoned and reachable in code, so a caller meets a named refusal rather than an empty
 * result. `docs/governance/williamos-experience-v2-gate2-first-action-search-record.md` is the
 * durable record; §7 lists exactly what is not built and why.
 *
 * Invariants 10 and 11 are the mutating-path prerequisites and are tested where they live:
 * `tests/fabric-broker` (audit fails loudly, absence is not permanent) and
 * `tests/system-object-projection` (invariant 12's transport form, widened to the general case).
 */

const repositoryRoot = process.cwd()
const contract = readNodeIdentityContract(
  path.join(repositoryRoot, "config/execution-fabric/node-identity-contract.json"),
)

const NOW = Date.parse("2026-08-24T12:00:00.000Z")
const FRESH = "2026-08-24T11:59:00.000Z"

function inventoryNode(id: string, hostname: string, gpus: InventoryNode["gpus"] = []): InventoryNode {
  return {
    id,
    identity: { hostname, machine_id_sha256: "a".repeat(64) },
    role: "local-ai-gpu-execution-worker",
    gpus,
    evidence: { observed_at: FRESH, confidence: "observed", ttl_seconds: 300 },
  } as InventoryNode
}

/**
 * Objects come from the projection, never from a fixture shaped like one.
 *
 * A test that hand-builds a `SystemObject` proves the registry can resolve a literal, which is not
 * the claim. The claim is that it resolves what `projectSystemObjects` actually emits -- the second
 * object source is the thing #985 exists to prevent.
 */
function objectsFrom(...nodes: InventoryNode[]) {
  return projectSystemObjects({ inventory: nodes, transport: {}, observations: {}, contract, nowMs: NOW }).objects
}

const HERMES = inventoryNode("hermes-node", "HERMES")
const ATLAS = inventoryNode("atlas", "ATLAS")

describe("Invariant 1 - the bounded search record exists and states its boundary", () => {
  const record = fs.readFileSync(
    path.join(repositoryRoot, "docs/governance/williamos-experience-v2-gate2-first-action-search-record.md"),
    "utf8",
  )

  it("is a durable artifact, not a session claim", () => {
    expect(record.length).toBeGreaterThan(4000)
  })

  it("states every denominator the packet named, and the two it did not", () => {
    // "I looked and found nothing" is the failure mode the denominator rule exists to stop. A count
    // that is merely quoted from #995 is not a measurement either, which is why the record states
    // where it DISAGREES with the packet.
    for (const denominator of ["47", "30", "92", "26", "9", "5"]) {
      expect(record).toContain(denominator)
    }
    expect(record).toMatch(/server actions/i)
    expect(record).toMatch(/resident-gh/)
    expect(record).toMatch(/LOOM_OPERATIONS/)
  })

  it("gives every candidate an exact disqualifying citation rather than a verdict", () => {
    // A candidate ruled out without a file and a line is an opinion. The record's own ledger has
    // nine rows; spot-check that the strongest candidate carries real citations.
    expect(record).toMatch(/lib\/loom\/operations\.ts:\d+/)
    expect(record).toMatch(/app\/api\/loom\/run\/route\.ts:\d+/)
    expect(record).toMatch(/williamos-adapters\.mjs:\d+/)
  })

  it("routes the outcome as a charter amendment, not as a Gate 2 finding", () => {
    expect(record).toContain("CHARTER_AMENDMENT_REQUIRED")
    expect(record).toContain("BLOCKED_AUTHORITY")
  })
})

describe("Invariant 2 - one registry resolves a canonical SystemObject to a deterministic action", () => {
  it("resolves a node the projection emitted, and reports the object it chose", () => {
    const objects = objectsFrom(HERMES)
    const resolution = resolveObjectAction("inspect hermes", { objects })

    expect(resolution.state).toBe("resolved")
    expect(resolution.action?.id).toBe("system.node.inspect")
    expect(resolution.object?.kind).toBe("NODE")
    expect((resolution.object as NodeObject).nodeId).toBe("hermes-node")
  })

  it("refuses when there is no object graph rather than inventing one", () => {
    // The registry has no second object source. With nothing projected there is nothing to resolve,
    // and saying so beats resolving against a name the caller happened to type.
    const resolution = resolveObjectAction("inspect atlas")
    expect(resolution.state).toBe("clarification_required")
    expect(resolution.object).toBeNull()
    expect(resolution.reason).toMatch(/no object graph/i)
  })

  it("refuses a name that is not in the current graph", () => {
    const resolution = resolveObjectAction("inspect omen", { objects: objectsFrom(ATLAS) })
    expect(resolution.state).toBe("clarification_required")
    expect(resolution.reason).toMatch(/named no object/i)
  })

  it("lets a name be the object without losing the page that shares it", () => {
    // `hermes` is a node in the fabric and a page in the cockpit. Which one is meant is decided by
    // whether an object action claimed the name, not by preferring one catalogue over the other.
    const objects = objectsFrom(HERMES)
    expect(resolveObjectAction("inspect hermes", { objects })).toMatchObject({
      state: "resolved",
      action: { id: "system.node.inspect" },
    })
    expect(resolveObjectAction("open hermes", { objects })).toMatchObject({
      state: "resolved",
      action: { id: "capability.hermes" },
    })
  })
})

/**
 * A mutating node action that does NOT ship.
 *
 * #995 requires the ambiguity invariant proved "with a mutating pair, not only a navigation pair",
 * and the search record is the reason there is no shipped pair to use: no existing canonical action
 * qualifies, and adding one to the catalogue to make a test convenient would be the overturned
 * reversal arriving through a fixture. So the RULE is proved against an injected descriptor, and a
 * separate test asserts the shipped catalogue still contains no such action.
 *
 * `drain` is the charter's own vocabulary (`charter:264-266`) and is deliberately one of the verbs
 * the search record confirmed does not exist on `main`.
 */
const HYPOTHETICAL_DRAIN = {
  id: "test.node.drain",
  kind: "mutate_object",
  subject: "NODE",
  label: "Drain node",
  href: null,
  keywords: ["drain"],
  navigationAliases: ["drain"],
  mutating: true,
  requiresAuthority: true,
  implementation: null,
} as const

describe("Invariant 3 - ambiguity is refused, not resolved by ranking", () => {
  const objects = objectsFrom(HERMES, ATLAS)
  const registry = [...objectActionRegistry, HYPOTHETICAL_DRAIN]

  it("refuses two plausible targets for a MUTATING action and executes nothing", () => {
    // charter:285-287's own example: `restart it` with multiple plausible destructive targets must
    // require disambiguation. Navigation ambiguity shows the wrong page; mutation ambiguity changes
    // the wrong machine.
    const resolution = resolveObjectAction("drain hermes and atlas", { objects, registry })

    expect(resolution.state).toBe("clarification_required")
    expect(resolution.object).toBeNull()
    expect(resolution.reason).toMatch(/disambiguation is required/i)
    expect(resolution.executionAuthorized).toBe(false)
    expect(resolution.authority.granted).toBe(false)

    // Refusing is not the same as hiding: the operator is shown what the options were.
    expect(resolution.candidates.map((c) => (c.object as NodeObject).nodeId).sort())
      .toEqual(["atlas", "hermes-node"])
  })

  it("resolves the same mutating action when exactly one target matches", () => {
    // The refusal above must be about ambiguity, not about mutations being refused generally --
    // otherwise the invariant would pass for the wrong reason.
    const resolution = resolveObjectAction("drain hermes", { objects, registry })
    expect(resolution.state).toBe("authority_required")
    expect(resolution.action?.id).toBe("test.node.drain")
    expect((resolution.object as NodeObject).nodeId).toBe("hermes-node")
    expect(resolution.authority).toEqual({ required: true, granted: false })
  })

  it("refuses when more than one ACTION matches, so there is nothing to disambiguate the object for", () => {
    const resolution = resolveObjectAction("inspect hermes and open the lab", { objects })
    expect(resolution.state).toBe("clarification_required")
    expect(resolution.reason).toMatch(/more than one action/i)
  })

  it("narrows by the object graph rather than by a guess", () => {
    // `inspect` names both the node and the accelerator action. Dropping the accelerator one because
    // no accelerator matched is deterministic and comes from the projection -- it is not ranking, and
    // it is what keeps the common case usable without weakening the exactly-one rule.
    const resolution = resolveObjectAction("inspect atlas", { objects })
    expect(resolution.state).toBe("resolved")
    expect(resolution.action?.id).toBe("system.node.inspect")
  })
})

describe("Invariant 4 - context changes ranking, and only ranking", () => {
  const objects = objectsFrom(HERMES, ATLAS)

  it("reorders candidates for a reading action", () => {
    const plain = resolveObjectAction("inspect hermes and atlas", { objects })
    expect(plain.candidates).toHaveLength(2)

    const second = plain.candidates[1].object!.objectId
    const steered = resolveObjectAction("inspect hermes and atlas", { objects, recentObjectIds: [second] })

    // Same candidate set, different order, different chosen object. Context moved the ranking and
    // nothing else -- and because a read reports every candidate, the choice is visible rather than
    // silent.
    expect(steered.candidates).toHaveLength(2)
    expect(plain.object!.objectId).not.toBe(second)
    expect(steered.object!.objectId).toBe(second)
    expect(new Set(steered.candidates.map((c) => c.object!.objectId)))
      .toEqual(new Set(plain.candidates.map((c) => c.object!.objectId)))
  })

  it("cannot retarget an ambiguous mutation, however strongly it ranks", () => {
    // The whole point. Ranking is computed for a mutating action and then deliberately not used to
    // choose, so the refusal is identical whichever object context prefers.
    const registry = [...objectActionRegistry, HYPOTHETICAL_DRAIN]
    const verdicts = objects.map((object) =>
      resolveObjectAction("drain hermes and atlas", { objects, registry, recentObjectIds: [object.objectId] }),
    )

    for (const verdict of verdicts) {
      expect(verdict.state).toBe("clarification_required")
      expect(verdict.object).toBeNull()
      expect(verdict.executionAuthorized).toBe(false)
    }
  })

  it("gives context nothing it could retarget with", () => {
    // Cheaper than any code path being careful: there is no field on ResolutionContext that names a
    // target. Context can say what was used recently and what the graph holds, and that is all.
    const source = fs.readFileSync(path.join(repositoryRoot, "lib/intent/object-action-registry.ts"), "utf8")
    const contextType = source.slice(
      source.indexOf("export type ResolutionContext"),
      source.indexOf("export type ResolutionState"),
    )
    expect(contextType).toMatch(/objects\?:/)
    expect(contextType).toMatch(/recentObjectIds\?:/)
    expect(contextType).not.toMatch(/targetObjectId|forceObject|selectedObject/)
  })
})

describe("Invariant 5 - the registry grants no authority", () => {
  it("keeps executionAuthorized and authority.granted structurally false", () => {
    const objects = objectsFrom(HERMES)
    for (const input of ["inspect hermes", "open the lab", "", "nonsense that matches nothing"]) {
      const resolution = resolveObjectAction(input, { objects })
      expect(resolution.executionAuthorized).toBe(false)
      expect(resolution.authority.granted).toBe(false)
    }
  })

  it("keeps the router's shipped guarantee after the convergence", () => {
    const route = routeUniversalIntent("Deploy the cockpit to production")
    expect(route.state).toBe("authority_required")
    expect(route.executionAuthorized).toBe(false)
    expect(route.authority).toEqual({ required: true, granted: false })
  })

  it("declares authority as required on every mutating descriptor, and supplies none", () => {
    for (const action of objectActionRegistry.filter((a) => a.mutating)) {
      expect(action.requiresAuthority).toBe(true)
    }
  })
})

describe("Invariant 6 - navigation that ships today still works", () => {
  it("keeps every descriptor resolvable", () => {
    // Four modes and twelve supporting capabilities, unchanged in content by the move.
    expect(workbenchActionRegistry).toHaveLength(16)
    expect(workbenchActionRegistry.filter((a) => a.kind === "mode")).toHaveLength(4)
    for (const action of workbenchActionRegistry) {
      expect(action.href).not.toBe("")
      expect(findWorkbenchActions(action.label).map((a) => a.id)).toContain(action.id)
    }
  })

  it("preserves the exactly-one-match rule under generalization", () => {
    expect(matchWorkbenchNavigationTarget("open the lab")?.action.id).toBe("capability.lab")
    // Two plausible destinations name themselves; the rule returns null rather than picking.
    expect(matchWorkbenchNavigationTarget("open the lab or the workroom")).toBeNull()
  })

  it("still routes a navigation intent to the destination it always did", () => {
    expect(routeUniversalIntent("open the lab")).toMatchObject({
      state: "routed",
      intent: "navigation",
      destination: { href: "/fabric", action: "navigate" },
    })
  })
})

describe("Invariant 7 - no second command registry exists after this gate", () => {
  const registrySource = fs.readFileSync(path.join(repositoryRoot, "lib/intent/object-action-registry.ts"), "utf8")
  const routerSource = fs.readFileSync(path.join(repositoryRoot, "lib/intent/router.ts"), "utf8")
  const workbenchSource = fs.readFileSync(path.join(repositoryRoot, "lib/intent/workbench-action-registry.ts"), "utf8")

  it("gives the action-kind union exactly one owner", () => {
    // The union's members, as a literal. Declared once or the concept has two owners again --
    // which is precisely what §5.3 found and what "do not create a second command registry" forbids.
    const declares = (source: string) => /\|\s*"council_review"/.test(source) && /\|\s*"request_execution"/.test(source)
    expect(declares(registrySource)).toBe(true)
    expect(declares(routerSource)).toBe(false)
    expect(declares(workbenchSource)).toBe(false)
  })

  it("gives SIGNALS and DESTINATIONS exactly one owner", () => {
    expect(registrySource).toMatch(/export const SIGNALS/)
    expect(registrySource).toMatch(/export const DESTINATIONS/)
    expect(routerSource).not.toMatch(/^const SIGNALS/m)
    expect(routerSource).not.toMatch(/^const DESTINATIONS/m)
    // The router reads them; it does not restate them.
    expect(routerSource).toMatch(/from "@\/lib\/intent\/object-action-registry"/)
  })

  it("gives the descriptors exactly one owner, leaving a facade rather than a copy", () => {
    // A facade maps the one catalogue into an older shape. A copy declares its own entries -- the
    // difference is whether editing one file can make the two disagree.
    expect(workbenchSource).not.toMatch(/id: "mode\.home"/)
    expect(registrySource).toMatch(/id: "mode\.home"/)
    expect(workbenchActionRegistry.map((a) => a.id).sort())
      .toEqual(objectActionRegistry.filter((a) => a.subject === "workbench").map((a) => a.id).sort())
  })

  it("keeps the intent classification behaviour the router shipped", () => {
    expect(Object.keys(SIGNALS).sort()).toEqual(["answer", "council", "execution", "outcome", "research"])
    expect(Object.keys(DESTINATIONS).sort()).toEqual(["answer", "council", "execution", "outcome", "research"])
  })
})

describe("Invariant 8 - the control-center disposition is recorded and enforced", () => {
  it("records FENCE with its reasoning and its reconsideration condition", () => {
    expect(CONTROL_CENTER_FENCE.disposition).toBe("FENCE")
    expect(CONTROL_CENTER_FENCE.boundary).toContain("control-center/")
    expect(CONTROL_CENTER_FENCE.boundary).toContain("scripts/williamos_commands.py")
    expect(CONTROL_CENTER_FENCE.reason.length).toBeGreaterThan(80)
    expect(CONTROL_CENTER_FENCE.reconsiderWhen.length).toBeGreaterThan(20)
  })

  it("is tested as a fence: nothing in the registry reaches across it", () => {
    // A fence that is only declared is a comment. This is the assertion that makes it a boundary --
    // and it is the check that would have caught the third catalogue being absorbed by accident.
    for (const action of objectActionRegistry) {
      for (const fenced of CONTROL_CENTER_FENCE.boundary) {
        expect(action.implementation ?? "").not.toContain(fenced)
      }
    }
  })

  it("does not import from the fenced surface", () => {
    for (const file of ["object-action-registry.ts", "router.ts", "workbench-action-registry.ts"]) {
      const source = fs.readFileSync(path.join(repositoryRoot, "lib/intent", file), "utf8")
      const imports = [...source.matchAll(/^import[\s\S]*?from "([^"]+)"/gm)].map((m) => m[1])
      for (const specifier of imports) {
        expect(specifier).not.toMatch(/control-center/)
        expect(specifier).not.toMatch(/williamos_commands/)
      }
    }
  })
})

describe("Invariants 9, 12 and 13 - the chosen action, which this gate did not choose", () => {
  it("types the absence of a governed mutation instead of returning an empty result", () => {
    for (const kind of ["NODE", "ACCELERATOR"] as const) {
      const resolution = resolveObjectMutation(kind)
      expect(resolution.state).toBe("clarification_required")
      expect(resolution.unavailable?.reason).toBe("CHARTER_AMENDMENT_REQUIRED")
      expect(resolution.unavailable?.continuation).toBe("CONT-EXPV2-FIRST-ACTION")
      expect(resolution.executionAuthorized).toBe(false)
    }
  })

  it("points at the durable record rather than restating its conclusion", () => {
    expect(MUTATION_UNAVAILABLE.detail).toContain("gate2-first-action-search-record")
  })

  it("carries no SystemObject mutation, which is the finding and not an oversight", () => {
    // If this ever fails, an action was added to a node or accelerator subject -- and unless a
    // charter amendment was recorded first, that is the overturned reversal arriving through a
    // catalogue entry. The search record's §5 ledger is what a reviewer should re-run.
    const systemMutations = objectActionRegistry.filter(
      (action) => (action.subject === "NODE" || action.subject === "ACCELERATOR") && action.mutating,
    )
    expect(systemMutations).toEqual([])
  })

  it("keeps the catalogued resource mutations visible rather than hidden", () => {
    // They exist on main, they are correctly shaped, and they are not SystemObject actions. Leaving
    // them out would make this registry look complete while a mutating path ran beside it.
    const resourceMutations = objectActionRegistry.filter((action) => action.subject === "project_resource")
    expect(resourceMutations.map((a) => a.id).sort()).toEqual([
      "resource.relocate-source",
      "resource.restore-database",
    ])
    for (const action of resourceMutations) {
      expect(action.mutating).toBe(true)
      expect(action.requiresAuthority).toBe(true)
      expect(action.implementation).toBe("lib/resource/mutation.ts")
    }
  })
})

describe("the catalogue describes shipped code, not intentions", () => {
  it("points every implementation claim at a file that exists", () => {
    // A registry is an invitation to describe something that is not there. Checking the paths is
    // cheap and it is the difference between a catalogue and a wish list.
    for (const action of objectActionRegistry) {
      if (!action.implementation) continue
      expect(fs.existsSync(path.join(repositoryRoot, action.implementation)), action.implementation).toBe(true)
    }
  })
})
