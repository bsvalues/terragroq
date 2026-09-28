import { describe, expect, it } from "vitest"
import fs from "node:fs"

import {
  adoptModelRuntime,
  mergePublishedRuntimes,
  publishedHostNodeId,
  registryRuntimePublications,
} from "../scripts/execution-fabric/adopt-model-runtime.mjs"

const adoption = JSON.parse(fs.readFileSync("config/execution-fabric/model-runtime-adoption.json", "utf8"))
const seed = JSON.parse(fs.readFileSync("config/execution-fabric/registry.seed.json", "utf8"))

// The registry schema's runtime entry is strict: only these keys, and only these details keys.
const RUNTIME_KEYS = new Set(["id", "kind", "version", "state", "endpoint", "details"])
const DETAILS_KEYS = new Set(["authentication", "exposure", "filesystem", "fstype", "models", "mount_by_uuid", "observation", "options", "source", "start_type"])
const RUNTIME_STATES = new Set(["healthy", "running", "stopped", "degraded", "unavailable", "unknown"])

describe("IF-03 adoption reaches the production registry assembly", () => {
  it("the core assembly consumes the adoption record (not merely the seed)", () => {
    const core = fs.readFileSync("scripts/execution-fabric/assemble-registry-core.mjs", "utf8")
    expect(core).toMatch(/registryRuntimePublications\(adoption, declared\.id\)/)
    expect(core).toMatch(/mergePublishedRuntimes\(/)
  })

  it("publications project into registry-legal entries with the bound model inventory", () => {
    const entries = registryRuntimePublications(adoption, "hermes-node")
    const ollama = entries.find((entry) => entry.id === "hermes-ollama")
    expect(ollama).toBeDefined()
    expect(ollama.kind).toBe("ollama")
    // the record's lifecycle is a commissioning observation, never live evidence
    expect(ollama.state).toBe("unknown")
    expect(ollama.details.models).toHaveLength(8)
    expect(ollama.details.models).toContain("williamos-qwen3-14b:64k")
    for (const entry of entries) {
      for (const key of Object.keys(entry)) expect(RUNTIME_KEYS.has(key)).toBe(true)
      for (const key of Object.keys(entry.details ?? {})) expect(DETAILS_KEYS.has(key)).toBe(true)
      expect(RUNTIME_STATES.has(entry.state)).toBe(true)
    }
  })

  it("the external model API is published to its host and is NOT presented as live", () => {
    const entries = registryRuntimePublications(adoption, "hermes-node")
    const external = entries.find((entry) => entry.id === "openrouter-api")
    expect(external.kind).toBe("external-model-api")
    expect(external.state).toBe("unknown")
    expect(external.details ?? {}).not.toHaveProperty("models")
  })

  it("an unbound runtime, unknown artifact, or missing registry kind is refused", () => {
    const noPublication = { ...adoption, runtimePublications: [] }
    expect(() => registryRuntimePublications(noPublication, "hermes-node")).not.toThrow()
    expect(publishedHostNodeId(noPublication, "hermes-ollama")).toBeNull()
    const badArtifact = JSON.parse(JSON.stringify(adoption))
    badArtifact.runtimePublications[0].modelArtifactIds = ["ghost-artifact"]
    expect(() => registryRuntimePublications(badArtifact, "hermes-node")).toThrow(/IF03_PUBLICATION_UNKNOWN_ARTIFACT:ghost-artifact/)
    const unknownRuntime = JSON.parse(JSON.stringify(adoption))
    unknownRuntime.runtimePublications[0].runtimeId = "ghost-runtime"
    expect(() => registryRuntimePublications(unknownRuntime, "hermes-node")).toThrow(/IF03_PUBLICATION_UNKNOWN_RUNTIME:ghost-runtime/)
    const noKind = JSON.parse(JSON.stringify(adoption))
    delete noKind.runtimePublications[0].registryKind
    expect(() => registryRuntimePublications(noKind, "hermes-node")).toThrow(/IF03_PUBLICATION_MISSING_REGISTRY_KIND/)
  })

  it("a live probe's own model inventory wins; the record only fills a silence, and says so", () => {
    const publications = registryRuntimePublications(adoption, "hermes-node")

    // (a) the probe reported no inventory -> the reviewed record fills it, labelled
    const filled = []
    const silent = mergePublishedRuntimes([{ id: "ollama", kind: "ollama", state: "healthy", details: {} }], publications, filled)
    expect(silent[0].details.models).toContain("qwen3:14b")
    expect(filled.some((warning) => warning.startsWith("MODEL_INVENTORY_FROM_ADOPTION_RECORD hermes-ollama"))).toBe(true)

    // (b) the probe reported its own inventory -> it is authoritative, the record does not overwrite
    const untouched = []
    const observed = mergePublishedRuntimes([{ id: "ollama", kind: "ollama", state: "healthy", details: { models: ["live-only-model"] } }], publications, untouched)
    expect(observed[0].details.models).toEqual(["live-only-model"])
    expect(untouched.some((warning) => warning.includes("MODEL_INVENTORY_FROM_ADOPTION_RECORD"))).toBe(false)

    // (c) nothing live reports the runtime -> it is listed, unknown, and explicitly not selectable
    const appended = []
    const withoutExternal = publications.filter((entry) => entry.id === "openrouter-api")
    const result = mergePublishedRuntimes([{ id: "docker", kind: "docker", state: "running" }], withoutExternal, appended)
    const external = result.find((entry) => entry.id === "openrouter-api")
    expect(external.state).toBe("unknown")
    expect(appended.some((warning) => warning.startsWith("ADOPTED_RUNTIME_NOT_LIVE_OBSERVED openrouter-api"))).toBe(true)
  })

  it("adopting the real record attaches adopted runtimes that stay schema-legal", () => {
    const registry = adoptModelRuntime(seed, adoption)
    const hermes = registry.nodes.find((node) => node.id === "hermes-node")
    const ollama = hermes.runtimes.find((runtime) => runtime.id === "hermes-ollama")
    expect(ollama.kind).toBe("ollama")
    expect(ollama.version).toBe("0.9.2")
    for (const runtime of registry.nodes.flatMap((node) => node.runtimes ?? [])) {
      for (const key of Object.keys(runtime)) expect(RUNTIME_KEYS.has(key)).toBe(true)
      for (const key of Object.keys(runtime.details ?? {})) expect(DETAILS_KEYS.has(key)).toBe(true)
    }
  })
})
