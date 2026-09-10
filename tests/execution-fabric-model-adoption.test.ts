import { describe, expect, it } from "vitest"
import fs from "node:fs"

import {
  ModelIdentitySchema,
  RuntimeCapabilitySchema,
  RuntimeIdentitySchema,
} from "@/components/operator/intelligence-fabric-contracts"

const adoption = JSON.parse(fs.readFileSync("config/execution-fabric/model-runtime-adoption.json", "utf8"))

describe("IF-03 current model/runtime adoption", () => {
  it("every ModelArtifact record validates against the ModelIdentity contract", () => {
    for (const artifact of adoption.modelArtifacts) {
      const result = ModelIdentitySchema.safeParse(artifact)
      expect(result.success, JSON.stringify(result.success ? [] : result.error.issues.slice(0, 3))).toBe(true)
    }
  })

  it("an ACTIVE model carries a proven capability-evidence binding scoped to an exact runtime version", () => {
    const active = adoption.modelArtifacts.filter((a) => a.admission === "ACTIVE")
    expect(active.length).toBeGreaterThan(0)
    for (const artifact of active) {
      expect(artifact.admissionEvidence?.verdict).toBe("PROVEN")
      // the binding names the exact runtime revision, never a moving label
      expect(artifact.admissionEvidence?.runtime?.version).not.toMatch(/latest|main|stable/i)
    }
  })

  it("every Runtime record validates against the RuntimeIdentity contract", () => {
    for (const runtime of adoption.runtimes) {
      const result = RuntimeIdentitySchema.safeParse(runtime)
      expect(result.success, JSON.stringify(result.success ? [] : result.error.issues.slice(0, 3))).toBe(true)
    }
  })

  it("every runtime capability record validates and is scoped to hardware + exact version", () => {
    for (const cap of adoption.runtimeCapabilities) {
      const result = RuntimeCapabilitySchema.safeParse(cap)
      expect(result.success, JSON.stringify(result.success ? [] : result.error.issues.slice(0, 3))).toBe(true)
      expect(cap.hardwarePlatform).toBeTruthy()
      expect(cap.runtimeVersion).not.toMatch(/latest|main/i)
    }
  })

  it("the registry can reconstruct the exact model/runtime/policy identity from the record", () => {
    const artifact = adoption.modelArtifacts[0]
    // immutableIdentity binds repository@revision exactly — the registry can reconstruct the model.
    expect(artifact.immutableIdentity).toBe(`${artifact.repository}@${artifact.revision}`)
    // the runtime the evidence binds to is present as a runtime record
    const bound = adoption.runtimes.find((r) => r.id === artifact.admissionEvidence.runtime.id)
    expect(bound, "evidence-bound runtime must exist as a runtime record").toBeDefined()
    expect(bound.version).toBe(artifact.admissionEvidence.runtime.version)
  })

  it("the promoted resident-model policy is mapped into provenance but remains authoritative", () => {
    const p = adoption.policyProvenance
    expect(p.promotionStatus).toBe("PROMOTED")
    expect(p.policySha256).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(p.sourceOfTruth).toContain("model-policy.json")
    // the record explicitly does not supersede the legacy policy
    expect(p.note).toMatch(/remains the authority/i)
  })

  it("records no new model download — every artifact references an already-present local source", () => {
    for (const artifact of adoption.modelArtifacts) {
      expect(artifact.source).not.toMatch(/^https?:\/\//) // local adoption, not a fetch
      expect(["huggingface", "local", "ollama"]).toContain(artifact.source)
    }
  })
})
