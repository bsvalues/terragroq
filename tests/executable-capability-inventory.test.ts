import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_CAPABILITY_INVENTORY,
  type CapabilityRuntimeReality,
} from "@/components/operator/multi-agent-capability-registry"

type ProofClassification = "RUNTIME_PROVEN" | "STATIC_READ_ONLY" | "EXCLUDED"

type DocumentedCapability = {
  capabilityId: string
  label: string
  status: string
  executionClass: string
  runtimeReality: CapabilityRuntimeReality
  proofClassification: ProofClassification
  claim: string
}

const INVENTORY_PATH = "docs/governance/executable-capability-inventory.md"
const ROW_PATTERN =
  /^\| `([^`]+)` \| ([^|]+?) \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| `([^`]+)` \| (.+) \|$/

function proofClassification(runtimeReality: CapabilityRuntimeReality): ProofClassification {
  if (runtimeReality === "NON_RUNTIME") return "STATIC_READ_ONLY"
  if (runtimeReality === "EXCLUDED") return "EXCLUDED"
  return "RUNTIME_PROVEN"
}

function readDocumentedCapabilities(): DocumentedCapability[] {
  return readFileSync(INVENTORY_PATH, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(ROW_PATTERN)
      if (!match) return []
      return [{
        capabilityId: match[1],
        label: match[2].trim(),
        status: match[3],
        executionClass: match[4],
        runtimeReality: match[5] as CapabilityRuntimeReality,
        proofClassification: match[6] as ProofClassification,
        claim: match[7].trim(),
      }]
    })
}

describe("executable capability human inventory", () => {
  it("documents every registry capability exactly once with exact current truth", () => {
    const documented = readDocumentedCapabilities()
    const documentedIds = documented.map((entry) => entry.capabilityId)

    expect(new Set(documentedIds).size).toBe(documentedIds.length)
    expect(documented).toEqual(MULTI_AGENT_CAPABILITY_INVENTORY.map((entry) => ({
      capabilityId: entry.capabilityId,
      label: entry.label,
      status: entry.status,
      executionClass: entry.executionClass,
      runtimeReality: entry.runtimeReality,
      proofClassification: proofClassification(entry.runtimeReality),
      claim: entry.claim,
    })))
  })

  it("defines the complete runtime-reality and AC-12 proof taxonomy", () => {
    const document = readFileSync(INVENTORY_PATH, "utf8")

    for (const runtimeReality of [
      "NON_RUNTIME",
      "HOSTED_SESSION_ONLY",
      "LIVE_BOUNDED_RESIDENT",
      "EXCLUDED",
    ]) {
      expect(document).toContain(`\`${runtimeReality}\``)
    }
    for (const proofClass of ["RUNTIME_PROVEN", "STATIC_READ_ONLY", "EXCLUDED"]) {
      expect(document).toContain(`\`${proofClass}\``)
    }
  })

  it("preserves the bounded Hermes and terminal issue 357 distinctions", () => {
    const document = readFileSync(INVENTORY_PATH, "utf8")

    expect(document).toContain("native non-elevated Windows supervisor")
    expect(document).toContain("production web app does not host the worker")
    expect(document).toContain("current host liveness")
    expect(document).toContain("issue #357")
    expect(document).toContain("terminal")
  })
})
