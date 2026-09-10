import { describe, expect, it } from "vitest"
import fs from "node:fs"

import {
  ModelIdentitySchema,
  RuntimeCapabilitySchema,
  RuntimeIdentitySchema,
} from "@/components/operator/intelligence-fabric-contracts"
import { adoptModelRuntime, loadAdoption, reconstructIdentity } from "../scripts/execution-fabric/adopt-model-runtime.mjs"

const adoption = JSON.parse(fs.readFileSync("config/execution-fabric/model-runtime-adoption.json", "utf8"))
const seed = JSON.parse(fs.readFileSync("config/execution-fabric/registry.seed.json", "utf8"))

describe("IF-03 records validate against the contracts", () => {
  it("every ModelArtifact record validates against ModelIdentity", () => {
    for (const artifact of adoption.modelArtifacts) {
      expect(ModelIdentitySchema.safeParse(artifact).success).toBe(true)
    }
  })
  it("every Runtime record validates against RuntimeIdentity", () => {
    for (const runtime of adoption.runtimes) {
      expect(RuntimeIdentitySchema.safeParse(runtime).success).toBe(true)
    }
  })
  it("every runtime capability record validates against RuntimeCapability", () => {
    for (const cap of adoption.runtimeCapabilities) {
      expect(RuntimeCapabilitySchema.safeParse(cap).success).toBe(true)
    }
  })
})

describe("IF-03 adoption is consumed by the registry, not just recorded", () => {
  it("adopting the record into the seed attaches each runtime to a known node", () => {
    const registry = adoptModelRuntime(seed, adoption)
    expect(registry.modelRuntimeAdoption.attached.length).toBeGreaterThan(0)
    for (const { nodeId } of registry.modelRuntimeAdoption.attached) {
      expect(seed.nodes.some((n) => n.id === nodeId), `adoption host ${nodeId} must be a known node`).toBe(true)
    }
  })

  it("an adoption naming an unknown node is denied, never invented", () => {
    const bad = JSON.parse(JSON.stringify(adoption))
    bad.runtimes = [{ ...bad.runtimes[0], id: "ghost-runtime" }]
    expect(() => adoptModelRuntime(seed, bad)).toThrow(/IF03_ADOPTION_UNKNOWN_NODE/)
  })

  it("the assembled registry reconstructs the exact model, runtime, and policy identity", () => {
    const registry = adoptModelRuntime(seed, adoption)
    const identity = reconstructIdentity(registry)
    expect(identity).not.toBeNull()
    expect(identity.model).toBe(`${adoption.modelArtifacts[0].repository}@${adoption.modelArtifacts[0].revision}`)
    expect(identity.runtime).not.toBeNull()
    expect(identity.runtime.id).toBe(adoption.modelArtifacts[0].admissionEvidence.runtime.id)
    expect(identity.policy.status).toBe("PROMOTED")
    expect(identity.policy.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})

describe("IF-03 local adoption is evidenced, not implied by a label", () => {
  it("the adopted model carries concrete local-presence evidence (path + artifact digest)", () => {
    const lp = adoption.localPresence
    expect(lp).toBeDefined()
    expect(lp.path).toMatch(/Qwen3-8B\/model$/)
    expect(lp.configDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(lp.host).toBe("daedalus")
  })

  it("no model download is implied: adoption evidence references the on-disk artifact", () => {
    const ev = adoption.modelArtifacts[0].admissionEvidence.evidenceRef
    expect(ev).toMatch(/^local:\/\//)
    expect(ev).toContain(lp.configDigestForTest ?? "configDigest:")
  })
})

const lp = adoption.localPresence
