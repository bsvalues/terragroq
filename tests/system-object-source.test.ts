import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { loadSystemObjectSource, SystemObjectSourceError } from "@/lib/system/system-object-source"
import type { NodeObject } from "@/lib/system/system-object"

/**
 * The loader is the first production consumer `projectSystemObjects` has ever had, and the thing it
 * must not become is a second object source. These tests are mostly about that: what it reads, what
 * it refuses, and whether the one rule it restates still agrees with the projection that owns it.
 */

const repositoryRoot = process.cwd()

async function fabricRoot(nodes: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), "system-object-source-"))
  await writeFile(path.join(root, "nodes.json"), JSON.stringify(nodes, null, 2), "utf8")
  return root
}

const ATLAS = { transport: "ssh", host: "192.168.88.5", user: "williamos", os: "linux", role: "server" }
const HERMES = { transport: "local", host: "127.0.0.1", user: "bsval", os: "windows", role: "coordinator" }

describe("the canonical object source", () => {
  it("projects the reviewed inventory rather than a build artifact", async () => {
    const source = await loadSystemObjectSource({ fabricRoot: await fabricRoot({ atlas: ATLAS }) })

    // Every node in the committed seed projects. If this ever reads
    // `.artifacts/execution-fabric/registry.snapshot.json` instead, a fresh checkout answers
    // differently from a built one and this is what notices.
    const nodeIds = source.graph.objects.filter((o) => o.kind === "NODE").map((o) => (o as NodeObject).nodeId)
    expect(nodeIds).toContain("atlas")
    expect(nodeIds).toContain("hermes-node")
    expect(nodeIds.length).toBeGreaterThanOrEqual(4)
  })

  it("binds each node to the transport endpoint the projection bound it to", async () => {
    // The one rule this module restates, checked against the owner of that rule rather than asserted.
    // The projection derives `transport` for a node through its own endpoint binding; if this
    // module's binding ever disagrees, a node would project with a transport while this returns no
    // endpoint for it, or an endpoint pointing at a different record.
    const source = await loadSystemObjectSource({
      fabricRoot: await fabricRoot({ atlas: ATLAS, hermes: HERMES }),
    })

    for (const object of source.graph.objects) {
      if (object.kind !== "NODE") continue
      const endpoint = source.endpointByNodeId[object.nodeId]
      if (object.transport.state === "present") {
        expect(endpoint).toBeDefined()
        expect(source.transport[endpoint]).toBeDefined()
        expect(source.transport[endpoint].host).toBe(object.transport.host)
        expect(source.transport[endpoint].user).toBe(object.transport.user)
      } else {
        expect(endpoint).toBeUndefined()
      }
    }

    expect(source.endpointByNodeId).toMatchObject({ atlas: "atlas", "hermes-node": "hermes" })
  })

  it("does not promote an endpoint the reviewed contract does not claim", async () => {
    // A line in a local JSON file must not mint a node. The projection reports it as an unverified
    // endpoint candidate; this loader must not turn it into a binding.
    const source = await loadSystemObjectSource({
      fabricRoot: await fabricRoot({ atlas: ATLAS, "someone-elses-box": { transport: "ssh", host: "10.9.9.9" } }),
    })

    expect(Object.values(source.endpointByNodeId)).not.toContain("someone-elses-box")
    expect(source.graph.unverifiedEndpointCandidates.map((c) => c.endpoint)).toContain("someone-elses-box")
  })

  it("fails closed when the transport registry is unreadable", async () => {
    const missing = path.join(tmpdir(), "system-object-source-absent-" + process.pid)
    await expect(loadSystemObjectSource({ fabricRoot: missing })).rejects.toBeInstanceOf(SystemObjectSourceError)
    await expect(loadSystemObjectSource({ fabricRoot: missing })).rejects.toMatchObject({
      code: "TRANSPORT_UNAVAILABLE",
    })
  })

  it("fails closed when the identity contract is unreadable", async () => {
    await expect(
      loadSystemObjectSource({
        repositoryRoot: path.join(repositoryRoot, "tests"),
        fabricRoot: await fabricRoot({ atlas: ATLAS }),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_UNAVAILABLE" })
  })

  it("reads the deployed source root, not the runtime working directory", async () => {
    // The supported HERMES deployment is a flat standalone bundle with no `config/` beside
    // `server.js`. Resolving against `process.cwd()` there would refuse every request with
    // CONTRACT_UNAVAILABLE while every test passed, because a test runs from the repository.
    const previous = process.env.WILLIAMOS_PROJECT_ROOT
    const runtimeDir = await mkdtemp(path.join(tmpdir(), "standalone-runtime-"))
    const previousCwd = process.cwd()
    try {
      process.env.WILLIAMOS_PROJECT_ROOT = repositoryRoot
      process.chdir(runtimeDir)
      const source = await loadSystemObjectSource({ fabricRoot: await fabricRoot({ atlas: ATLAS }) })
      expect(source.graph.objects.length).toBeGreaterThan(0)
    } finally {
      process.chdir(previousCwd)
      if (previous === undefined) delete process.env.WILLIAMOS_PROJECT_ROOT
      else process.env.WILLIAMOS_PROJECT_ROOT = previous
    }
  })

  it("exposes no writer", async () => {
    const source = await loadSystemObjectSource({ fabricRoot: await fabricRoot({ atlas: ATLAS }) })
    // A read-only projection whose loader offered a write would be the inverse the charter forbids.
    expect(Object.keys(source).sort()).toEqual(["contract", "endpointByNodeId", "graph", "transport"])
    expect(Object.isFrozen(source.graph.objects[0])).toBe(true)
  })
})
