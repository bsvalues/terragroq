import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, test } from "vitest"

type JsonObject = Record<string, unknown>

const repoRoot = path.resolve(__dirname, "..")
const topologyPath = path.join(repoRoot, "config", "lab-control", "lab-management-topology.v1.json")
const scriptPath = path.join(repoRoot, "scripts", "lab-control", "lab-ssh-config.ps1")
const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh"
const temporaryRoots: string[] = []
const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function canonicalTopology(): JsonObject {
  const topology = JSON.parse(readFileSync(topologyPath, "utf8")) as JsonObject
  const now = Date.now()
  for (const route of topology.managementRoutes as JsonObject[]) {
    route.evidence = {
      state: "VERIFIED",
      observedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + (6 * DAY_MS)).toISOString(),
    }
  }
  return topology
}

function allPropertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allPropertyNames)
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allPropertyNames(child)])
  }
  return []
}

function runRenderer(topology: JsonObject = canonicalTopology(), envOverrides: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "lab-topology-render-"))
  temporaryRoots.push(root)
  const profile = path.join(root, "profile")
  const sshDirectory = path.join(profile, ".ssh")
  mkdirSync(sshDirectory, { recursive: true })
  const activeConfig = path.join(sshDirectory, "config")
  writeFileSync(activeConfig, "# owner-managed sentinel\n", "utf8")

  const overridePath = path.join(root, "topology.json")
  writeFileSync(overridePath, `${JSON.stringify(topology, null, 2)}\n`, "utf8")

  const env = {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
  }
  delete env.LAB_CONTROL_TOPOLOGY_PATH
  delete env.LAB_CONTROL_TOPOLOGY_NOW_UTC
  Object.assign(env, envOverrides)
  env.LAB_CONTROL_TOPOLOGY_PATH = overridePath

  const result = spawnSync(
    pwsh,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", scriptPath],
    { cwd: repoRoot, encoding: "utf8", env, timeout: 30_000 },
  )

  return {
    ...result,
    activeConfig: readFileSync(activeConfig, "utf8"),
    profile,
  }
}

function validateSchema(topology: JsonObject) {
  const root = mkdtempSync(path.join(tmpdir(), "lab-topology-schema-"))
  temporaryRoots.push(root)
  const candidatePath = path.join(root, "topology.json")
  writeFileSync(candidatePath, `${JSON.stringify(topology, null, 2)}\n`, "utf8")
  const schemaPath = path.join(repoRoot, "config", "lab-control", "lab-management-topology.v1.schema.json")
  const quote = (value: string) => value.replaceAll("'", "''")
  const command = `$valid = Test-Json -LiteralPath '${quote(candidatePath)}' -SchemaFile '${quote(schemaPath)}' -ErrorAction Stop; if ($valid) { exit 0 }; exit 1`
  return spawnSync(pwsh, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  })
}

describe("WilliamOS lab management topology", () => {
  test("binds exactly the five physical lab nodes to the existing identity contract", () => {
    const topology = canonicalTopology()
    const nodes = topology.nodes as JsonObject[]
    const identityContract = JSON.parse(
      readFileSync(path.join(repoRoot, "config", "execution-fabric", "node-identity-contract.json"), "utf8"),
    ) as JsonObject
    const identityNodes = identityContract.nodes as JsonObject

    expect(topology.contract).toBe("williamos-lab-management-topology/1")
    expect(topology.identityContractRef).toBe("williamos-node-identity-v1")
    expect(nodes.map((node) => node.id)).toEqual(["omen", "hermes-node", "atlas", "aegis", "daedalus"])
    expect(nodes.every((node) => node.kind === "physical-lab-node")).toBe(true)
    expect(nodes.every((node) => node.required === true)).toBe(true)
    expect(nodes.map((node) => node.id).every((id) => Object.hasOwn(identityNodes, String(id)))).toBe(true)
    expect(nodes.map((node) => node.id)).not.toContain("azure")
  })

  test("declares one acyclic OMEN-origin management route for every remote node", () => {
    const topology = canonicalTopology()
    const nodes = topology.nodes as JsonObject[]
    const routes = topology.managementRoutes as JsonObject[]
    const nodeIds = new Set(nodes.map((node) => String(node.id)))
    const remoteIds = nodes.map((node) => String(node.id)).filter((id) => id !== topology.controlNodeId)

    expect(routes.map((route) => route.toNodeId)).toEqual(remoteIds)
    expect(new Set(routes.map((route) => route.sshAlias)).size).toBe(routes.length)
    expect(routes.every((route) => route.fromNodeId === "omen")).toBe(true)

    for (const route of routes) {
      const hops = route.viaNodeIds as string[]
      expect(nodeIds.has(String(route.toNodeId))).toBe(true)
      expect(hops).not.toContain(route.toNodeId)
      expect(new Set(hops).size).toBe(hops.length)
      expect(hops.every((hop) => nodeIds.has(hop))).toBe(true)
    }

    const daedalus = routes.find((route) => route.toNodeId === "daedalus")!
    expect(daedalus).toMatchObject({
      routeKind: "resident-relay",
      sshAlias: "daedalus",
      viaNodeIds: ["hermes-node"],
      endpoint: { host: "192.168.88.6", port: 2222, user: "daedalus", addressKind: "lan" },
    })
  })

  test("stores only symbolic credential and trust references, never secret material", () => {
    const topology = canonicalTopology()
    const names = allPropertyNames(topology)
    const serialized = JSON.stringify(topology)

    expect(names).not.toEqual(expect.arrayContaining(["password", "token", "privateKey", "privateKeyBytes", "secret"]))
    expect(serialized).not.toContain("BEGIN OPENSSH PRIVATE KEY")
    for (const route of topology.managementRoutes as JsonObject[]) {
      expect(route.identityRef).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(route.knownHostsRef).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(String(route.identityRef)).not.toMatch(/[\\/]/)
      expect(String(route.knownHostsRef)).not.toMatch(/[\\/]/)
    }
  })

  test("the published schema rejects node tuple permutations accepted by a generic item schema", () => {
    const invalid = canonicalTopology()
    const nodes = invalid.nodes as JsonObject[]
    nodes[0] = { ...nodes[0], displayName: "DAEDALUS", role: "resident-gpu-worker", probeProfile: "linux-generic" }

    const result = validateSchema(invalid)

    expect(result.status).not.toBe(0)
  })

  test("the published schema rejects route ownership and endpoint combinations outside the canonical binding", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    routes[1] = {
      ...routes[1],
      routeKind: "direct",
      endpoint: { host: "example.invalid", port: 2222, user: "impostor", addressKind: "lan" },
      viaNodeIds: [],
      identityRef: "HERMES_MANAGED",
      knownHostsRef: "HERMES_MANAGED",
    }

    const result = validateSchema(invalid)

    expect(result.status).not.toBe(0)
  })

  test("the published schema requires UTC-Z route evidence just like the semantic runtime", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    routes[0].evidence = {
      state: "VERIFIED",
      observedAt: "2026-09-20T07:27:53-07:00",
      expiresAt: "2026-09-27T07:27:53-07:00",
    }

    const result = validateSchema(invalid)

    expect(result.status).not.toBe(0)
  })

  test("renders a deterministic fail-closed OMEN SSH candidate without touching active config", () => {
    const first = runRenderer()
    const second = runRenderer()

    expect(first.status).toBe(0)
    expect(first.stderr).toBe("")
    expect(first.stdout).toBe(second.stdout)
    expect(first.stdout.endsWith("\n")).toBe(true)
    expect(first.stdout).toContain("# Candidate only: this output does not alter SSH configuration or establish host trust.")
    expect(first.stdout).toMatch(/^Host hermes$/m)
    expect(first.stdout).toMatch(/^Host atlas$/m)
    expect(first.stdout).not.toMatch(/^Host (?:aegis|daedalus)$/m)
    expect(first.stdout).toContain("# RELAY aegis: OMEN -> HERMES -> AEGIS (HERMES alias aegis)")
    expect(first.stdout).toContain("# RELAY daedalus: OMEN -> HERMES -> DAEDALUS (HERMES alias daedalus, endpoint 192.168.88.6:2222)")
    expect(first.stdout).toContain("  ProxyJump hermes")
    expect(first.stdout).toContain("  StrictHostKeyChecking yes")
    expect(first.stdout).toContain("  HostKeyAlgorithms ssh-ed25519")
    expect(first.stdout).toContain("  KnownHostsCommand none")
    expect(first.stdout).toContain("  IdentitiesOnly yes")
    expect(first.stdout).toContain("  BatchMode yes")
    expect(first.stdout).toContain("  PasswordAuthentication no")
    expect(first.stdout).toContain("  KbdInteractiveAuthentication no")
    expect(first.stdout).toContain("  ForwardAgent no")
    expect(first.stdout).toContain("  PermitLocalCommand no")
    expect(first.stdout).toContain("  ClearAllForwardings yes")
    expect(first.stdout).toContain("  ControlPath none")
    expect(first.stdout).toContain("  UserKnownHostsFile ~/.ssh/known_hosts")
    expect(first.stdout).not.toMatch(/StrictHostKeyChecking (?:no|accept-new)/i)
    expect(first.stdout).not.toMatch(/UserKnownHostsFile\s+(?:NUL|\/dev\/null)/i)
    expect(first.stdout).not.toMatch(/^\s*(?:ProxyCommand|LocalCommand|RemoteCommand|Include|Match)\b/m)
    expect(first.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test("rejects the complete topology before emitting partial SSH output", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    routes[1] = { ...routes[1], sshAlias: routes[0].sshAlias }

    const result = runRenderer(invalid)

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
    expect(result.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test.each([
    ["expired", -8 * DAY_MS, -DAY_MS],
    ["future", 6 * 60_000, 6 * DAY_MS],
  ] as const)("rejects %s VERIFIED route evidence before emitting SSH output", (_case, observedOffset, expiresOffset) => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    const now = Date.now()
    routes[0].evidence = {
      state: "VERIFIED",
      observedAt: new Date(now + observedOffset).toISOString(),
      expiresAt: new Date(now + expiresOffset).toISOString(),
    }

    const result = runRenderer(invalid)

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
    expect(result.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test("a process environment override cannot backdate expired route evidence", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    const now = Date.now()
    for (const route of routes) {
      route.evidence = {
        state: "VERIFIED",
        observedAt: new Date(now - (8 * DAY_MS)).toISOString(),
        expiresAt: new Date(now - DAY_MS).toISOString(),
      }
    }

    const result = runRenderer(invalid, {
      LAB_CONTROL_TOPOLOGY_NOW_UTC: new Date(now - (7 * DAY_MS)).toISOString(),
    })

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
  })

  test.each(["lowercase UTC suffix", "human-readable date"] as const)(
    "runtime rejects %s evidence that the published schema rejects",
    (invalidCase) => {
      const invalid = canonicalTopology()
      const routes = invalid.managementRoutes as JsonObject[]
      const observed = new Date(Date.now() - 60_000)
      const pad = (value: number) => String(value).padStart(2, "0")
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ]
      const observedAt = invalidCase === "lowercase UTC suffix"
        ? observed.toISOString().replace(/Z$/, "z")
        : `${months[observed.getUTCMonth()]} ${observed.getUTCDate()}, ${observed.getUTCFullYear()} ` +
          `${pad(observed.getUTCHours())}:${pad(observed.getUTCMinutes())}:${pad(observed.getUTCSeconds())}Z`
      routes[0].evidence = {
        state: "VERIFIED",
        observedAt,
        expiresAt: new Date(Date.now() + (6 * DAY_MS)).toISOString(),
      }

      const result = runRenderer(invalid)

      expect(result.status).toBe(2)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("TOPOLOGY_INVALID")
    },
  )

  test("rejects an AEGIS route that moves HERMES-owned trust and credentials onto OMEN", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    const aegis = routes.find((route) => route.toNodeId === "aegis")!
    Object.assign(aegis, {
      routeKind: "direct",
      viaNodeIds: [],
      identityRef: "OMEN_DEFAULT_ED25519",
      knownHostsRef: "OMEN_USER_KNOWN_HOSTS",
    })

    const result = runRenderer(invalid)

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
    expect(result.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test("rejects duplicate endpoint hosts before the historic AEGIS/DAEDALUS address drift can recur", () => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    const aegisEndpoint = routes[2].endpoint as JsonObject
    aegisEndpoint.host = (routes[3].endpoint as JsonObject).host

    const result = runRenderer(invalid)

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
    expect(result.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test.each([
    ["array-valued sshAlias", (route: JsonObject) => { route.sshAlias = ["hermes"] }],
    ["scalar viaNodeIds", (route: JsonObject) => { route.viaNodeIds = "hermes-node" }],
  ] as const)("rejects %s instead of coercing malformed JSON", (_case, mutate) => {
    const invalid = canonicalTopology()
    const routes = invalid.managementRoutes as JsonObject[]
    const route = _case === "scalar viaNodeIds" ? routes[1] : routes[0]
    mutate(route)

    const result = runRenderer(invalid)

    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("TOPOLOGY_INVALID")
    expect(result.activeConfig).toBe("# owner-managed sentinel\n")
  })

  test("active operator documentation no longer teaches the stale two-node network", () => {
    const runbook = readFileSync(path.join(repoRoot, "docs", "runbooks", "omen-lab-control.md"), "utf8")
    const example = readFileSync(path.join(repoRoot, "scripts", "lab-control", "ssh_config.example"), "utf8")

    for (const document of [runbook, example]) {
      expect(document).not.toMatch(/192\.168\.1\.(?:154|156)/)
    }
    expect(runbook).toContain("OMEN")
    expect(runbook).toContain("HERMES")
    expect(runbook).toContain("ATLAS")
    expect(runbook).toContain("AEGIS")
    expect(runbook).toContain("DAEDALUS")
    expect(runbook).toContain("lab-aegis")
    expect(runbook).toContain("lab-daedalus")
    expect(runbook).toContain("lab-ssh-config")
    expect(example).toContain("HostName 100.97.194.84")
    expect(example).toContain("HostName 192.168.88.8")
    expect(example).toContain("StrictHostKeyChecking yes")
    expect(example).toContain("HostKeyAlgorithms ssh-ed25519")
    expect(example).toContain("RELAY daedalus")
  })
})
