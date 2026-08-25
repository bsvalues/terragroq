import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }))
vi.mock("@/lib/db", () => ({ pool: { query: vi.fn() } }))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: vi.fn() }))
vi.mock("@/lib/fabric/audit.mjs", () => ({ requireLedger: vi.fn() }))
vi.mock("@/lib/fabric/broker.mjs", () => ({
  brokeredExec: vi.fn(),
  resolveBrokeredNode: vi.fn(),
  BrokerDenied: class BrokerDenied extends Error {},
}))
vi.mock("@/lib/system/system-object-source", () => ({
  loadSystemObjectSource: vi.fn(),
  SystemObjectSourceError: class SystemObjectSourceError extends Error {
    constructor(message: string, readonly code: string) {
      super(message)
    }
  },
}))

import { pool } from "@/lib/db"
import { requireLedger } from "@/lib/fabric/audit.mjs"
import { brokeredExec, resolveBrokeredNode } from "@/lib/fabric/broker.mjs"
import { appendGovernanceEvent } from "@/lib/governance/events"
import { getSession } from "@/lib/session"
import { loadSystemObjectSource } from "@/lib/system/system-object-source"
import {
  assertObservedIdentity,
  dialectFor,
  observeCommand,
  planIdentityStamp,
  readPriorStamp,
  stampCommand,
  STAMP_CONTRACT,
  STAMP_PATHS,
  SYSTEM_OBJECT_MUTATIONS,
  verifyCommand,
  verifyPostState,
  type StampPlan,
} from "@/lib/system/node-identity-stamp"
import { readNodeIdentityContract } from "@/lib/system/node-identity-contract"
import { projectSystemObjects, type InventoryNode, type NodeObject } from "@/lib/system/system-object"
import { POST } from "@/app/api/system/node/stamp-identity/route"

/**
 * #995 acceptance invariant 9: the chosen action satisfies all eleven qualifying criteria, EACH with
 * a test. Invariant 12: post-state is verified by observation, and the evidence records what was
 * observed rather than what was requested. Invariant 13's governed-execution leg: the journey runs on
 * canonical seams.
 *
 * Invariant 13's TERMINAL leg is not tested here and cannot be: it needs a live node, and HERMES is
 * under the #997 migration lane's reservation. That is typed as
 * `CONT-EXPV2-FIRST-ACTION-RUNTIME-SETTLEMENT` in the pickup search record, not quietly omitted.
 * #995 permits merging on deterministic tests and forbids declaring Gate 2 ACCEPTED on them.
 *
 * Every criterion below is labelled with its number so a reviewer can check the set is complete
 * rather than take the word of a describe block.
 */

const repositoryRoot = process.cwd()
const contract = readNodeIdentityContract(
  path.join(repositoryRoot, "config/execution-fabric/node-identity-contract.json"),
)

const NOW = Date.parse("2026-08-24T12:00:00.000Z")
const STAMPED_AT = "2026-08-24T12:00:00.000Z"

function inventoryNode(id: string, hostname: string, role = "authoritative-durable-state-server"): InventoryNode {
  return {
    id,
    identity: { hostname, machine_id_sha256: "a".repeat(64) },
    role,
    gpus: [],
    evidence: { observed_at: "2026-08-24T11:59:00.000Z", confidence: "observed", ttl_seconds: 300 },
  } as InventoryNode
}

const POSIX_RECORD = { transport: "ssh", host: "atlas", user: "williamos", os: "linux" }
const WINDOWS_RECORD = { transport: "ssh", host: "10.0.0.4", user: "williamos", os: "windows" }
const LOCAL_RECORD = { transport: "local", host: "127.0.0.1", user: "williamos", os: "linux" }

/**
 * Objects come from `projectSystemObjects`, never from a literal shaped like one.
 *
 * The claim under test is that a governed mutation acts on what the canonical projection emits. A
 * hand-built `NodeObject` would prove the planner can read an object literal, which is a different
 * and much weaker claim -- and building one would be the second object source #985 exists to prevent.
 */
function graphOf(nodes: InventoryNode[], transport: Record<string, unknown>) {
  return projectSystemObjects({
    inventory: nodes,
    transport: transport as never,
    contract,
    nowMs: NOW,
  })
}

const ATLAS = inventoryNode("atlas", "atlas")
const HERMES = inventoryNode("hermes-node", "HERMES", "local-ai-gpu-execution-worker")

function atlasObject(): NodeObject {
  return graphOf([ATLAS], { atlas: POSIX_RECORD }).objects[0] as NodeObject
}

function planFor(object: NodeObject, record: Record<string, unknown>): StampPlan {
  const verdict = planIdentityStamp(object, record, { stampedAt: STAMPED_AT })
  expect(verdict.ok).toBe(true)
  return verdict.plan as StampPlan
}

// ---------------------------------------------------------------------------------------------
// The action itself
// ---------------------------------------------------------------------------------------------

describe("criterion 1 - it is a mutation, and only one of its three commands mutates", () => {
  it("writes a file on the node", () => {
    const command = stampCommand(planFor(atlasObject(), POSIX_RECORD))
    expect(command).toContain("base64 -d >")
    expect(command).toContain("$HOME/.williamos/node-identity.json")
  })

  it("keeps the observation and the verification free of any write", () => {
    for (const command of [observeCommand("posix"), verifyCommand("posix"), observeCommand("windows"), verifyCommand("windows")]) {
      expect(command).not.toMatch(/base64 -d|WriteAllBytes|Set-Content|mkdir|New-Item/)
    }
  })
})

describe("criterion 2 - the subject is a SystemObject", () => {
  it("refuses an object that is not a NODE", () => {
    const accelerator = { kind: "ACCELERATOR", objectId: "accelerator:x" } as never
    expect(planIdentityStamp(accelerator, POSIX_RECORD, { stampedAt: STAMPED_AT })).toMatchObject({
      ok: false,
      refusal: "NOT_A_NODE",
    })
  })

  it("refuses a projected node the transport registry does not name", () => {
    // The projection emits inventory-only nodes with `transport: { state: "unknown" }`. They are real
    // canonical objects; there is simply no endpoint to act through, and that is a refusal rather
    // than an attempt.
    const orphan = graphOf([ATLAS], {}).objects[0] as NodeObject
    expect(planIdentityStamp(orphan, POSIX_RECORD, { stampedAt: STAMPED_AT })).toMatchObject({
      ok: false,
      refusal: "TRANSPORT_ABSENT",
    })
  })
})

describe("criterion 3 - selected: one object, never fleet-wide", () => {
  it("plans for exactly the node it was given and names no other", () => {
    const graph = graphOf([ATLAS, HERMES], { atlas: POSIX_RECORD, hermes: WINDOWS_RECORD })
    const atlas = graph.objects.find((o) => o.kind === "NODE" && o.nodeId === "atlas") as NodeObject
    const plan = planFor(atlas, POSIX_RECORD)

    expect(plan.nodeId).toBe("atlas")
    expect(plan.content).not.toContain("hermes")
    expect(stampCommand(plan)).not.toContain("hermes")
  })
})

describe("criterion 4 - chosen from a fixed catalogue by name", () => {
  it("carries an operation that is a member of the catalogue", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    expect(SYSTEM_OBJECT_MUTATIONS).toContain(plan.operation)
    expect(SYSTEM_OBJECT_MUTATIONS).toEqual(["node.stamp-identity"])
  })

  it("has no path by which caller text could become an operation", () => {
    // The planner takes an object, a record and a timestamp. There is no string parameter it could
    // interpret as a verb, which is the structural version of "chosen by name, never from text".
    const source = fs.readFileSync(path.join(repositoryRoot, "lib/system/node-identity-stamp.ts"), "utf8")
    const signature = source.slice(source.indexOf("export function planIdentityStamp"), source.indexOf("): StampVerdict"))
    expect(signature).not.toMatch(/operation\s*:\s*string/)
    expect(signature).not.toMatch(/command/)
  })
})

describe("criterion 5 - the target is derived from the canonical record", () => {
  it("takes every stamped field from the projected object", () => {
    const object = atlasObject()
    const plan = planFor(object, POSIX_RECORD)
    expect(JSON.parse(plan.content)).toEqual({
      contract: STAMP_CONTRACT,
      nodeId: object.nodeId,
      hostname: object.hostname,
      role: object.role,
      stampedAt: STAMPED_AT,
    })
  })

  it("writes to a fixed path that is not a parameter anywhere", () => {
    expect(planFor(atlasObject(), POSIX_RECORD).path).toBe(STAMP_PATHS.posix)
    const source = fs.readFileSync(path.join(repositoryRoot, "lib/system/node-identity-stamp.ts"), "utf8")
    // The only paths in the module are the two literals in STAMP_PATHS and the commands that build
    // them. No function accepts one.
    expect(source).not.toMatch(/path\s*:\s*string\s*[,)]/)
  })
})

describe("criterion 6 - unsafe input is refused rather than escaped, and nothing deletes", () => {
  it("refuses a node id, hostname or role that is not a plain identifier", () => {
    const cases: Array<[string, InventoryNode, string]> = [
      ["NODE_ID_REFUSED", inventoryNode("atlas; rm -rf /", "atlas"), "atlas"],
      ["HOSTNAME_REFUSED", inventoryNode("atlas", "atlas$(whoami)"), "atlas"],
      ["ROLE_REFUSED", inventoryNode("atlas", "atlas", "role with spaces"), "atlas"],
    ]
    for (const [refusal, node] of cases) {
      const object = graphOf([node], { atlas: POSIX_RECORD, [node.id]: POSIX_RECORD }).objects[0] as NodeObject
      const verdict = planIdentityStamp(object, POSIX_RECORD, { stampedAt: STAMPED_AT })
      expect(verdict.ok).toBe(false)
      expect(verdict.refusal).toBe(refusal)
      expect(verdict.plan).toBeNull()
    }
  })

  it("refuses a stampedAt that is not an ISO-8601 UTC instant", () => {
    expect(planIdentityStamp(atlasObject(), POSIX_RECORD, { stampedAt: "yesterday" })).toMatchObject({
      ok: false,
      refusal: "STAMPED_AT_REFUSED",
    })
  })

  it("never emits a deletion, on either dialect", () => {
    for (const record of [POSIX_RECORD, WINDOWS_RECORD]) {
      const command = stampCommand(planFor(atlasObject(), record))
      expect(command).not.toMatch(/\brm\b|Remove-Item|del\s|rmdir|Clear-Content|-Recurse/)
    }
  })

  it("carries content as base64 so no byte of it reaches a shell", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    const command = stampCommand(plan)
    const payload = /printf %s '([A-Za-z0-9+/=]+)'/.exec(command)?.[1]
    expect(payload).toBeTruthy()
    expect(Buffer.from(payload as string, "base64").toString("utf8")).toBe(plan.content)
    // The JSON body's own quotes and braces appear nowhere in the command.
    expect(command).not.toContain(plan.content)
  })
})

describe("criterion 7 - dialect-aware, and it agrees with the broker's own choice", () => {
  it("builds a PowerShell command for a Windows node and a POSIX one for a Linux node", () => {
    expect(stampCommand(planFor(atlasObject(), WINDOWS_RECORD))).toContain("FromBase64String")
    expect(stampCommand(planFor(atlasObject(), POSIX_RECORD))).toContain("base64 -d")
  })

  it("treats a local node as PowerShell, because that is what brokeredExec does with it", () => {
    // `brokeredExec` runs `transport: "local"` through `powershell -NoProfile -Command` regardless of
    // `os`. Reading `os` alone would hand a POSIX body to PowerShell.
    expect(dialectFor(LOCAL_RECORD)).toBe("windows")
    expect(dialectFor({ transport: "ssh", os: "linux" })).toBe("posix")
    expect(dialectFor({ transport: "ssh", os: "windows" })).toBe("windows")

    const broker = fs.readFileSync(path.join(repositoryRoot, "lib/fabric/broker.mjs"), "utf8")
    expect(broker).toContain(`const local = node.transport === "local"`)
    expect(broker).toMatch(/if \(local\) \{[\s\S]*?exec\("powershell"/)
  })
})

describe("criterion 10 - the post-state is observed, and disagreement is a refusal", () => {
  it("accepts only the digest and byte count the plan expected", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    const good = verifyPostState(plan, `digest=${plan.digest}\nbytes=${plan.byteLength}\n`, STAMPED_AT)
    expect(good).toMatchObject({ verified: true, observedDigest: plan.digest, observedBytes: plan.byteLength })
  })

  it("refuses different bytes, an unreadable reading, and a disagreeing pair", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    const other = crypto.createHash("sha256").update("something else").digest("hex")

    expect(verifyPostState(plan, `digest=${other}\nbytes=${plan.byteLength}`, STAMPED_AT).verified).toBe(false)
    expect(verifyPostState(plan, "", STAMPED_AT).verified).toBe(false)
    expect(verifyPostState(plan, `digest=${plan.digest}\nbytes=1`, STAMPED_AT)).toMatchObject({
      verified: false,
      reason: expect.stringMatching(/two readings disagree/),
    })
  })

  it("verifies through a second command rather than through the write's own report", () => {
    // The write reports a digest. If verification read that, the evidence would say what the command
    // claimed instead of what the node holds -- and would be blind to anything that happened in
    // between. This is also why `service.restart` could never qualify: it restarts the observer.
    const plan = planFor(atlasObject(), POSIX_RECORD)
    expect(stampCommand(plan)).toContain("written=")
    expect(verifyCommand("posix")).toContain("digest=")
    expect(verifyCommand("posix")).not.toContain("written=")
  })
})

describe("criterion 11 - safest: small, reversible, and additive", () => {
  it("writes a few hundred bytes and creates one file", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    expect(plan.byteLength).toBeLessThan(512)
    expect((stampCommand(plan).match(/node-identity\.json/g) ?? []).length).toBeLessThanOrEqual(2)
  })

  it("is reversible by repetition: stamping again yields another valid stamp of the same node", () => {
    const object = atlasObject()
    const first = planFor(object, POSIX_RECORD)
    const second = planIdentityStamp(object, POSIX_RECORD, { stampedAt: "2026-08-25T09:00:00.000Z" }).plan as StampPlan
    expect(JSON.parse(second.content).nodeId).toBe(JSON.parse(first.content).nodeId)
    expect(second.digest).not.toBe(first.digest)
  })
})

describe("the identity precondition, and what it does not claim", () => {
  it("refuses when the endpoint answers as a different machine", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    const prior = readPriorStamp("host=HERMES\npriorDigest=\npriorBytes=0")
    expect(assertObservedIdentity(contract, plan, prior)).toMatchObject({
      ok: false,
      refusal: "IDENTITY_MISMATCH",
    })
  })

  it("refuses when nothing was observed at all", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    expect(assertObservedIdentity(contract, plan, readPriorStamp("priorDigest=\npriorBytes=0"))).toMatchObject({
      ok: false,
      refusal: "IDENTITY_UNOBSERVED",
    })
  })

  it("accepts a hostname the reviewed contract resolves to this node", () => {
    const plan = planFor(atlasObject(), POSIX_RECORD)
    expect(assertObservedIdentity(contract, plan, readPriorStamp("host=atlas\npriorDigest=\npriorBytes=0"))).toMatchObject({
      ok: true,
      resolvedNodeId: "atlas",
    })
  })

  it("is never read back as an identity source", () => {
    // A file on a node must not be able to tell this lab which node that machine is. The projection
    // refuses to let a local record mint an identity; a stamp that became an identity source would
    // reopen that hole from the other side.
    for (const file of ["lib/system/system-object.ts", "lib/system/node-identity-contract.ts", "lib/system/system-object-source.ts"]) {
      expect(fs.readFileSync(path.join(repositoryRoot, file), "utf8")).not.toContain("node-identity.json")
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The route: invariants 12 and 13's governed-execution leg
// ---------------------------------------------------------------------------------------------

const mockedSession = vi.mocked(getSession)
const mockedQuery = vi.mocked(pool.query) as unknown as ReturnType<typeof vi.fn>
const mockedLedger = vi.mocked(requireLedger)
const mockedExec = vi.mocked(brokeredExec) as unknown as ReturnType<typeof vi.fn>
const mockedResolveNode = vi.mocked(resolveBrokeredNode) as unknown as ReturnType<typeof vi.fn>
const mockedSource = vi.mocked(loadSystemObjectSource) as unknown as ReturnType<typeof vi.fn>
const mockedEvent = vi.mocked(appendGovernanceEvent)

function request(body: unknown) {
  return new Request("http://localhost/api/system/node/stamp-identity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** The written payload, decoded from whatever command the route actually sent. */
function writtenContent(): string {
  const call = mockedExec.mock.calls.find((c) => c[2]?.action === "node.stamp-identity")
  const payload = /printf %s '([A-Za-z0-9+/=]+)'/.exec(String(call?.[1]))?.[1]
  return Buffer.from(String(payload), "base64").toString("utf8")
}

/**
 * A node that answers honestly: it reports the hostname the contract expects, and after the write it
 * reports a digest of exactly the bytes the route sent it.
 *
 * Deriving the verify answer from the observed command rather than from a constant is the point --
 * it means the post-state comparison is being made against the real payload, not against a fixture
 * that was written to agree with it.
 */
function honestNode({ tamper = false } = {}) {
  return async (_name: string, _command: string, options: { action?: string } = {}) => {
    if (options.action === "node.stamp-identity.observe") {
      return { stdout: "host=atlas\npriorDigest=\npriorBytes=0\n", stderr: "" }
    }
    if (options.action === "node.stamp-identity") return { stdout: "written=ok\n", stderr: "" }
    const content = tamper ? "tampered" : writtenContent()
    const digest = crypto.createHash("sha256").update(content, "utf8").digest("hex")
    return { stdout: `digest=${digest}\nbytes=${Buffer.byteLength(content, "utf8")}\n`, stderr: "" }
  }
}

describe("the governed route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSession.mockResolvedValue({ user: { id: "primary" } } as never)
    mockedQuery.mockResolvedValue({ rows: [{ ref: "GRANT-0007" }] })
    mockedLedger.mockResolvedValue(undefined)
    mockedResolveNode.mockResolvedValue(POSIX_RECORD)
    mockedSource.mockResolvedValue({
      graph: graphOf([ATLAS, HERMES], { atlas: POSIX_RECORD, hermes: WINDOWS_RECORD }),
      contract,
      endpointByNodeId: { atlas: "atlas", "hermes-node": "hermes" },
      transport: { atlas: POSIX_RECORD, hermes: WINDOWS_RECORD },
    })
    mockedExec.mockImplementation(honestNode())
  })

  it("refuses an unauthenticated caller before anything else happens", async () => {
    mockedSession.mockResolvedValueOnce(null as never)
    expect((await POST(request({ objectId: "node:atlas" }))).status).toBe(401)
    expect(mockedSource).not.toHaveBeenCalled()
    expect(mockedExec).not.toHaveBeenCalled()
  })

  it("criterion 8 - scopes the authority lookup to the session user", async () => {
    await POST(request({ objectId: "node:atlas" }))
    const [sql, params] = mockedQuery.mock.calls[0]
    expect(String(sql)).toContain(`"userId" = $3`)
    expect(params).toEqual(["#995", "node.stamp-identity", "primary"])
  })

  it("refuses without a recorded grant, and touches no node", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] })
    const response = await POST(request({ objectId: "node:atlas" }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: "AUTHORITY_NOT_GRANTED" })
    expect(mockedExec).not.toHaveBeenCalled()
  })

  it("criterion 9 - refuses when evidence cannot be written, before the node is contacted", async () => {
    mockedLedger.mockRejectedValueOnce(new Error("AUDIT_UNAVAILABLE: no ledger at /x"))
    const response = await POST(request({ objectId: "node:atlas" }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: "EVIDENCE_UNAVAILABLE" })
    expect(mockedExec).not.toHaveBeenCalled()
  })

  it("criterion 9 - requires the audit on the write and only on the write", async () => {
    await POST(request({ objectId: "node:atlas" }))
    const byAction = Object.fromEntries(
      mockedExec.mock.calls.map((call) => [call[2]?.action, Boolean(call[2]?.requireAudit)]),
    )
    expect(byAction).toEqual({
      "node.stamp-identity.observe": false,
      "node.stamp-identity": true,
      "node.stamp-identity.verify": false,
    })
  })

  it("refuses to write when the endpoint answers as another machine", async () => {
    mockedExec.mockImplementation(async (_n: string, _c: string, options: { action?: string } = {}) => {
      if (options.action === "node.stamp-identity.observe") return { stdout: "host=HERMES\npriorDigest=\npriorBytes=0", stderr: "" }
      throw new Error("the route must not have reached this")
    })
    const response = await POST(request({ objectId: "node:atlas" }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: "IDENTITY_MISMATCH" })
    expect(mockedExec).toHaveBeenCalledTimes(1)
  })

  it("invariant 13 - runs the journey and reports a verified post-state", async () => {
    const response = await POST(request({ objectId: "node:atlas" }))
    expect(response.status).toBe(200)
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload).toMatchObject({
      ok: true,
      operation: "node.stamp-identity",
      nodeId: "atlas",
      grant: "GRANT-0007",
      observedHostname: "atlas",
      returnTo: "node:atlas",
    })
    expect((payload.postState as Record<string, unknown>).verified).toBe(true)
    expect(mockedExec.mock.calls.map((c) => c[2]?.action)).toEqual([
      "node.stamp-identity.observe",
      "node.stamp-identity",
      "node.stamp-identity.verify",
    ])
  })

  it("invariant 12 - records what was observed after, not what was requested", async () => {
    await POST(request({ objectId: "node:atlas" }))
    const event = mockedEvent.mock.calls[0][0]
    expect(event).toMatchObject({ userId: "primary", entityType: "system_object_mutation", entityId: "node:atlas" })
    expect(event.after).toMatchObject({ verified: true, observedDigest: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(event.before).toEqual({ priorDigest: null, priorBytes: 0 })
  })

  it("invariant 12 - refuses to claim success it could not observe, and records the failure", async () => {
    mockedExec.mockImplementation(honestNode({ tamper: true }))
    const response = await POST(request({ objectId: "node:atlas" }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: "POST_STATE_UNVERIFIED" })
    expect(mockedEvent.mock.calls[0][0].after).toMatchObject({ verified: false })
  })

  it("cannot be told what to run, where to write, or which machine to reach", async () => {
    const clean = await POST(request({ objectId: "node:atlas" }))
    expect(clean.status).toBe(200)
    const cleanCommand = mockedExec.mock.calls.find((c) => c[2]?.action === "node.stamp-identity")?.[1]

    vi.clearAllMocks()
    mockedSession.mockResolvedValue({ user: { id: "primary" } } as never)
    mockedQuery.mockResolvedValue({ rows: [{ ref: "GRANT-0007" }] })
    mockedLedger.mockResolvedValue(undefined)
    mockedResolveNode.mockResolvedValue(POSIX_RECORD)
    mockedSource.mockResolvedValue({
      graph: graphOf([ATLAS, HERMES], { atlas: POSIX_RECORD, hermes: WINDOWS_RECORD }),
      contract,
      endpointByNodeId: { atlas: "atlas", "hermes-node": "hermes" },
      transport: { atlas: POSIX_RECORD, hermes: WINDOWS_RECORD },
    })
    mockedExec.mockImplementation(honestNode())

    const hostile = await POST(
      request({
        objectId: "node:atlas",
        path: "/etc/passwd",
        command: "rm -rf /",
        node: "hermes",
        content: "{}",
        operation: "node.drain",
      }),
    )
    expect(hostile.status).toBe(200)
    expect(mockedExec.mock.calls.find((c) => c[2]?.action === "node.stamp-identity")?.[1]).toBe(cleanCommand)
    expect(mockedExec.mock.calls.every((c) => c[0] === "atlas")).toBe(true)
  })

  it("invariant 3 on the execution path - an ambiguous mutating input executes nothing", async () => {
    const response = await POST(request({ input: "stamp atlas and hermes" }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: "CLARIFICATION_REQUIRED" })
    expect(mockedExec).not.toHaveBeenCalled()
  })

  it("resolves operator text through the registry when it names exactly one node", async () => {
    const response = await POST(request({ input: "stamp atlas" }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ nodeId: "atlas" })
  })

  it("refuses an input that resolves to a different action", async () => {
    const response = await POST(request({ input: "inspect atlas" }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: "ACTION_MISMATCH" })
    expect(mockedExec).not.toHaveBeenCalled()
  })

  it("requires exactly one selection shape", async () => {
    expect((await POST(request({}))).status).toBe(400)
    expect((await POST(request({ input: "stamp atlas", objectId: "node:atlas" }))).status).toBe(400)
  })

  it("refuses an object the canonical graph does not hold", async () => {
    const response = await POST(request({ objectId: "node:not-a-node" }))
    expect(response.status).toBe(404)
    expect(mockedExec).not.toHaveBeenCalled()
  })
})
