import { describe, expect, it } from "vitest"

import {
  evaluateHermesDoctrine,
  sha256,
} from "../scripts/lab-control/hermes/doctrine/evaluate-hermes-doctrine.mjs"
import { mintHermesDoctrine } from "../scripts/lab-control/hermes/doctrine/mint-hermes-doctrine.mjs"
import { normalizeHermesRawObservation } from "../scripts/lab-control/hermes/doctrine/normalize-hermes-observation.mjs"

const HOST = "a".repeat(64)
const NOW = new Date("2026-09-02T12:00:00.000Z")
const FRESH_AT = "2026-09-02T11:59:30.000Z"

const listener = (protocol, address, port, owner) => ({ protocol, address, port, owner })

function baseObservation(overrides = {}) {
  return {
    schema: "hermes-host-observation/1",
    observedAt: FRESH_AT,
    hostIdentitySha256: HOST,
    inventory: {
      services: [
        {
          name: "williamos-hermes-https",
          displayName: "WilliamOS HERMES HTTPS",
          startMode: "auto",
          state: "running",
          startName: "localservice",
          pathNameSha256: "b".repeat(64),
        },
      ],
      scheduledTasks: [{ path: "\\hermesdoctrinecheck", xmlSha256: "c".repeat(64) }],
      listeners: [
        listener("tcp", "127.0.0.1", 3210, "c:\\hermes\\node\\node.exe"),
        listener("tcp", "127.0.0.1", 11434, "c:\\program files\\ollama\\ollama.exe"),
      ],
      dockerResidents: [
        {
          name: "williamos-nous-hermes-agent",
          imageReference: "williamos/agent:latest",
          imageDigest: "sha256:d".repeat(8),
          restartPolicy: "unless-stopped",
          state: "running",
          publishedPorts: [],
          mounts: [],
        },
      ],
      longLivedProcesses: [
        {
          executablePath: "c:\\williamos\\node.exe",
          owner: "nt authority\\system",
          commandLineSha256: "e".repeat(64),
        },
      ],
      monitoringComponents: [{ id: "task:\\hermesdoctrinecheck", kind: "scheduled-task", reference: "\\hermesdoctrinecheck" }],
      ...overrides,
    },
  }
}

function doctrineFor(observation) {
  return {
    schema: "hermes-appliance-doctrine/1",
    applianceVersion: "HERMES_APPLIANCE_V1",
    frozenAt: observation.observedAt,
    hostIdentitySha256: observation.hostIdentitySha256,
    maxObservationAgeSeconds: 300,
    sourceObservationSha256: sha256(observation),
    acceptanceSha256: "f".repeat(64),
    inventory: observation.inventory,
  }
}

function evaluate(observation) {
  return evaluateHermesDoctrine(doctrineFor(baseObservation()), observation, { now: NOW })
}

describe("HERMES appliance doctrine comparator (stable-vs-ephemeral, #1034/#1035)", () => {
  it("passes on an identical fresh observation", () => {
    const result = evaluate(baseObservation())
    expect(result.status).toBe("PASS")
    expect(result.code).toBe("HERMES_DOCTRINE_CONFORMANT")
    expect(result.driftCount).toBe(0)
  })

  it("treats the nvcontainer loopback UDP telemetry as ephemeral (2026-09-02 comparator patch)", () => {
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("udp", "127.0.0.1", 10012, "c:\\program files\\nvidia corporation\\nvcontainer\\nvcontainer.exe"),
      ],
    })
    const result = evaluate(obs)
    expect(result.driftCount).toBe(0)
    expect(result.drift.listeners.unexpected).toEqual([])
  })

  it("does NOT exempt a non-loopback or tcp nvcontainer socket — the exemption is exactly loopback UDP", () => {
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("tcp", "127.0.0.1", 10012, "c:\\program files\\nvidia corporation\\nvcontainer\\nvcontainer.exe"),
      ],
    })
    expect(evaluate(obs).driftCount).toBe(1)
  })

  it("keeps node/docker listeners as real drift — an unexpected wildcard Codex-lane dev server fails the gate", () => {
    // Proven live 2026-09-02: tcp|::|24678|node.exe (a Codex desktop lane dev server) was held
    // as drift and only cleared when the process went away. It was never absorbed by the
    // ephemeral classifier.
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("tcp", "0.0.0.0", 24678, "c:\\program files\\nodejs\\node.exe"),
      ],
    })
    const result = evaluate(obs)
    expect(result.status).toBe("FAIL")
    expect(result.code).toBe("HERMES_DOCTRINE_DRIFT")
    expect(result.drift.listeners.unexpected.map((item) => item.key)).toContain(
      "tcp|0.0.0.0|24678|c:\\program files\\nodejs\\node.exe",
    )
  })

  it("classifies browser/agent listeners as ephemeral noise", () => {
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("udp", "127.0.0.1", 51234, "c:\\program files (x86)\\microsoft\\edge\\application\\msedge.exe"),
        listener("tcp", "127.0.0.1", 53000, "c:\\users\\bs\\appdata\\local\\openai\\codex\\bin\\codex.exe"),
      ],
    })
    expect(evaluate(obs).driftCount).toBe(0)
  })

  it("#1141 P1: an agent-named TCP listener on a NON-loopback address is ingress drift, never noise", () => {
    for (const [protocol, address, port, owner] of [
      ["tcp", "0.0.0.0", 4444, "c:\\users\\bs\\appdata\\local\\openai\\codex\\bin\\codex.exe"],
      ["tcp", "192.168.88.9", 4444, "c:\\program files\\microsoft\\edge\\application\\msedge.exe"],
    ] as const) {
      const obs = baseObservation({
        listeners: [...baseObservation().inventory.listeners, listener(protocol, address, port, owner)],
      })
      const result = evaluate(obs)
      expect(result.code, `${protocol} ${address}:${port} ${owner}`).toBe("HERMES_DOCTRINE_DRIFT")
    }
  })

  it("#1141 P1: agent UDP sockets on high/mDNS ports stay ephemeral on any address (Tailscale/mDNS churn)", () => {
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("udp", "192.168.88.9", 51932, "c:\\program files\\tailscale\\tailscale.exe"),
        listener("udp", "0.0.0.0", 5353, "c:\\program files\\microsoft\\edge\\application\\msedge.exe"),
      ],
    })
    expect(evaluate(obs).driftCount).toBe(0)
  })


  it("strips the per-logon service suffix and treats service state as volatile", () => {
    const declared = baseObservation().inventory.services[0]
    const obs = baseObservation({
      services: [
        { ...declared, name: "williamos-hermes-https_500a02", displayName: "WilliamOS HERMES HTTPS (500a02)", state: "stopped" },
      ],
    })
    expect(evaluate(obs).driftCount).toBe(0)
  })

  it("treats pathNameSha256 rotation as volatile only for OS-self-updating services; pinned services compare it exactly", () => {
    const declared = baseObservation().inventory.services[0]
    const pinnedRotated = baseObservation({
      services: [{ ...declared, pathNameSha256: "9".repeat(64) }],
    })
    expect(evaluate(pinnedRotated).drift.services.changed.length).toBe(1)

    const obsSvc = {
      name: "wuauserv",
      displayName: "Windows Update",
      startMode: "manual",
      state: "running",
      startName: "localservice",
      pathNameSha256: "1".repeat(64),
    }
    const doctrine = doctrineFor(baseObservation())
    doctrine.inventory.services = [obsSvc]
    const observed = baseObservation()
    observed.inventory.services = [{ ...obsSvc, pathNameSha256: "2".repeat(64) }]
    expect(evaluateHermesDoctrine(doctrine, observed, { now: NOW }).driftCount).toBe(0)
  })

  it("fails closed on a missing declared pinned listener", () => {
    const obs = baseObservation({ listeners: [baseObservation().inventory.listeners[0]] })
    const result = evaluate(obs)
    expect(result.drift.listeners.missing.length).toBe(1)
    expect(result.status).toBe("FAIL")
  })

  it("fails closed on a stopped declared docker resident", () => {
    const obs = baseObservation()
    obs.inventory.dockerResidents = [{ ...obs.inventory.dockerResidents[0], state: "exited" }]
    const result = evaluate(obs)
    expect(result.drift.dockerResidents.changed.length).toBe(1)
  })

  it("records STALE truthfully and never blesses an over-age observation", () => {
    const obs = baseObservation()
    obs.observedAt = "2026-09-02T11:00:00.000Z"
    const result = evaluate(obs)
    expect(result.freshness.state).toBe("STALE")
    expect(result.status).toBe("FAIL")
    expect(result.code).toBe("HERMES_DOCTRINE_OBSERVATION_STALE")
  })

  it("refuses a foreign host and malformed schemas", () => {
    const foreign = baseObservation()
    foreign.hostIdentitySha256 = "b".repeat(64)
    expect(() => evaluate(foreign)).toThrow("DOCTRINE_HOST_IDENTITY_MISMATCH")
    const broken = baseObservation()
    broken.inventory.listeners = {}
    expect(() => evaluate(broken)).toThrow(/CATEGORIES_INVALID|_INVALID/)
  })

  it("rejects duplicate listener identity keys fail-closed (normalizer must dedupe first)", () => {
    const obs = baseObservation({
      listeners: [
        ...baseObservation().inventory.listeners,
        listener("tcp", "127.0.0.1", 3210, "c:\\hermes\\node\\node.exe"),
      ],
    })
    expect(() => evaluate(obs)).toThrow("OBSERVATION_listeners_IDENTITY_INVALID")
  })
})

describe("HERMES raw-observation normalizer (#1034 defects)", () => {
  const rawEnvelope = (raw) => ({
    schema: "hermes-host-raw-observation/1",
    observedAt: FRESH_AT,
    hostIdentitySha256: HOST,
    raw,
  })

  it("dedupes a socket reported twice and unwraps the PowerShell single-array docker wrap", () => {
    const proc = {
      processId: 4242,
      parentProcessId: 4,
      name: "node.exe",
      executablePath: "C:\\hermes\\node\\node.exe",
      commandLine: "node server.js",
      creationDate: "2026-09-02T10:00:00Z",
      owner: "NT AUTHORITY\\SYSTEM",
      ownerEvidenceState: "OBSERVED",
    }
    const raw = rawEnvelope({
      services: [],
      scheduledTaskXml: [],
      tcpListeners: [
        { protocol: "tcp", localAddress: "127.0.0.1", localPort: 3210, owningProcess: 4242 },
        { protocol: "tcp", localAddress: "127.0.0.1", localPort: 3210, owningProcess: 4242 },
      ],
      udpEndpoints: [],
      processes: [proc],
      dockerInspect: [{ value: [{ Name: "/williamos-hermes-inference-proxy", Config: { Image: "x" }, NetworkSettings: { Ports: {} }, Mounts: [], HostConfig: { RestartPolicy: { Name: "always" } }, State: { Status: "running" }, Image: "sha256:z" }], Count: 1 }],
    })
    const obs = normalizeHermesRawObservation(raw)
    expect(obs.inventory.listeners).toHaveLength(1)
    expect(obs.inventory.dockerResidents.map((item) => item.name)).toEqual(["williamos-hermes-inference-proxy"])
  })

  it("#1141 P1: monitoring component identity strips the per-session service suffix like the comparator", () => {
    const svc = (name) => ({ name, displayName: "Hermes Monitor", startMode: "auto", state: "running", startName: "users", pathName: "C:\\bin\\svc.exe" })
    const envelope = (name) => rawEnvelope({ services: [svc(name)], scheduledTaskXml: [], tcpListeners: [], udpEndpoints: [], processes: [], dockerInspect: [] })
    const a = normalizeHermesRawObservation(envelope("williamos-hermes-https_500a02"))
    const b = normalizeHermesRawObservation(envelope("williamos-hermes-https_600b03"))
    expect(a.inventory.monitoringComponents).toEqual(b.inventory.monitoringComponents)
    expect(a.inventory.monitoringComponents[0].id).toBe("service:williamos-hermes-https")
  })

  it("refuses a long-lived runtime process with an unobserved owner", () => {
    const raw = rawEnvelope({
      services: [],
      scheduledTaskXml: [],
      tcpListeners: [],
      udpEndpoints: [
        { protocol: "udp", localAddress: "127.0.0.1", localPort: 5353, owningProcess: 999 },
      ],
      processes: [
        {
          processId: 999,
          parentProcessId: 4,
          name: "ollama.exe",
          executablePath: "C:\\bin\\ollama.exe",
          commandLine: "ollama serve",
          creationDate: "2026-09-01T10:00:00Z",
          owner: "UNKNOWN",
          ownerEvidenceState: "READ_ONLY_PROBE_FAILED",
        },
      ],
      dockerInspect: [],
    })
    expect(() => normalizeHermesRawObservation(raw)).toThrow("HERMES_RUNTIME_PROCESS_OWNER_UNKNOWN")
  })
})

describe("HERMES doctrine mint gate (freeze authority, #1035)", () => {
  const acceptance = (observation) => ({
    schema: "hermes-appliance-freeze-acceptance/1",
    applianceVersion: "HERMES_APPLIANCE_V1",
    acceptedAt: NOW.toISOString(),
    hostIdentitySha256: observation.hostIdentitySha256,
    observationSha256: sha256(observation),
    gates: { inference: "PASS", security: "PASS", offHostRecovery: "PASS", storageRoles: "PASS", workbench: "PASS" },
  })

  it("mints a doctrine frozen from the attested observation", () => {
    const obs = baseObservation()
    const doctrine = mintHermesDoctrine(obs, acceptance(obs))
    expect(doctrine.schema).toBe("hermes-appliance-doctrine/1")
    expect(doctrine.maxObservationAgeSeconds).toBe(300)
    expect(evaluateHermesDoctrine(doctrine, obs, { now: NOW }).code).toBe("HERMES_DOCTRINE_CONFORMANT")
  })

  it("refuses to mint unless every freeze gate is PASS", () => {
    const obs = baseObservation()
    const weak = acceptance(obs)
    weak.gates.security = "FAIL"
    expect(() => mintHermesDoctrine(obs, weak)).toThrow("HERMES_DOCTRINE_MINT_GATE_NOT_GREEN:security")
  })

  it("refuses a mint whose acceptance observation hash does not match", () => {
    const obs = baseObservation()
    const tampered = acceptance(obs)
    tampered.observationSha256 = "0".repeat(64)
    expect(() => mintHermesDoctrine(obs, tampered)).toThrow("HERMES_DOCTRINE_MINT_OBSERVATION_MISMATCH")
  })
})
