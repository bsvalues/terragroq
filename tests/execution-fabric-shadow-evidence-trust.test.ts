import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  DEFAULT_SHADOW_AUTHORITY_REGISTRY,
  DEFAULT_SHADOW_OUTCOME_REGISTRY,
  loadShadowEvidenceTrustRegistries,
  validateShadowAuthorityRegistry,
  validateShadowEvidenceTrust,
  validateShadowOutcomeRegistry,
} from "../scripts/execution-fabric/shadow-evidence-trust.mjs"

type JsonObject = Record<string, any>

const artifactValue = {
  schema_version: "0.1-shadow-outcome-evidence",
  work_order_id: "WO-LOCAL-107",
  actual_target_node: "omen",
  status: "COMPLETED",
  result: "SUCCEEDED",
  started_at: "2026-07-04T14:40:56.000Z",
  completed_at: "2026-07-04T14:41:08.345Z",
  authority_outcome: {
    status: "COMPLIANT",
    reference: "authority-local-omen-manual-v1",
    checked_at: "2026-07-04T14:40:56.000Z",
  },
  resource_observations: [
    { metric: "cpu_load_pct", unit: "percent", value: 31.5, observed_at: "2026-07-04T14:41:00.000Z" },
  ],
}
const artifactBytes = Buffer.from(`${canonicalizeJcs(artifactValue)}\n`)
const artifactSha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex")
const retainedSourceSha256 = "b".repeat(64)
const reviewedCommit = "c".repeat(40)

function outcomeRegistry(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "0.1-shadow-outcome-registry",
    registry_id: "execution-fabric-shadow-outcomes",
    entries: [{
      artifact_sha256: artifactSha256,
      work_order_id: "WO-LOCAL-107",
      actual_target_node: "omen",
      retained_source_sha256: retainedSourceSha256,
      authority_reference: "authority-local-omen-manual-v1",
      reviewed_commit: reviewedCommit,
      status: "ACTIVE",
    }],
    ...overrides,
  }
}

function authorityRegistry(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "0.1-shadow-authority-registry",
    registry_id: "execution-fabric-shadow-authorities",
    entries: [{
      reference: "authority-local-omen-manual-v1",
      work_order_id: "WO-LOCAL-107",
      allowed_canonical_nodes: ["omen"],
      valid_from: "2026-07-04T14:00:00.000Z",
      expires_at: "2026-07-04T15:00:00.000Z",
      reviewed_commit: reviewedCommit,
      status: "ACTIVE",
    }],
    ...overrides,
  }
}

function trust(overrides: JsonObject = {}) {
  return validateShadowEvidenceTrust({
    artifactBytes,
    expectedArtifactSha256: artifactSha256,
    retainedSourceSha256,
    outcomeRegistry: outcomeRegistry(),
    authorityRegistry: authorityRegistry(),
    ...overrides,
  }) as JsonObject
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function expectRejected(action: () => unknown, detail: RegExp) {
  expect(action).toThrowError(detail)
}

describe("Execution Fabric shadow evidence trust registries", () => {
  it("loads the reviewed production admission and rejects an unrelated fixture outcome", () => {
    expect(DEFAULT_SHADOW_OUTCOME_REGISTRY).toMatch(/shadow-outcome-registry\.json$/)
    expect(DEFAULT_SHADOW_AUTHORITY_REGISTRY).toMatch(/shadow-authority-registry\.json$/)
    const loaded = loadShadowEvidenceTrustRegistries()

    expect(loaded.outcome_registry.status).toBe("VALID")
    expect(loaded.outcome_registry.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifact_sha256: "9bd0b44bc7f4dc77fd2f24e590a048c7b964884da76d37d917d145799caea285",
        work_order_id: "WO-EF-SHADOW-001",
        actual_target_node: "hermes-node",
        status: "ACTIVE",
      }),
    ]))
    expect(loaded.authority_registry.status).toBe("VALID")
    expect(loaded.authority_registry.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reference: "issue-538-phase2-shadow-001",
        work_order_id: "WO-EF-SHADOW-001",
        allowed_canonical_nodes: ["hermes-node"],
        status: "ACTIVE",
      }),
      expect.objectContaining({
        reference: "issue-538-phase2-shadow-002",
        work_order_id: "WO-EF-SHADOW-002",
        allowed_canonical_nodes: ["hermes-node"],
        status: "ACTIVE",
      }),
    ]))
    expectRejected(() => trust({
      outcomeRegistry: loaded.outcome_registry,
      authorityRegistry: loaded.authority_registry,
    }), /outcome artifact is not present in the reviewed outcome registry/)
  })

  it("settles exact artifact, source, Work Order, node, authority, review, and time bindings", () => {
    const first = trust()
    const second = trust({
      outcomeRegistry: validateShadowOutcomeRegistry(outcomeRegistry()),
      authorityRegistry: validateShadowAuthorityRegistry(authorityRegistry()),
    })

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      status: "TRUSTED",
      observation_only: true,
      artifact_sha256: artifactSha256,
      retained_source_sha256: retainedSourceSha256,
      work_order_id: "WO-LOCAL-107",
      actual_target_node: "omen",
      authority_reference: "authority-local-omen-manual-v1",
      outcome_reviewed_commit: reviewedCommit,
      authority_reviewed_commit: reviewedCommit,
      dispatch_allowed: false,
      execution_authorized: false,
      remote_systems_modified: false,
    })
  })

  it("rejects unknown registry and entry fields", () => {
    expectRejected(() => validateShadowOutcomeRegistry(outcomeRegistry({ extra: true })), /must contain exactly/)
    const outcome = outcomeRegistry()
    outcome.entries[0].command = "run"
    expectRejected(() => validateShadowOutcomeRegistry(outcome), /must contain exactly/)

    expectRejected(() => validateShadowAuthorityRegistry(authorityRegistry({ extra: true })), /must contain exactly/)
    const authority = authorityRegistry()
    authority.entries[0].token = "not-a-token"
    expectRejected(() => validateShadowAuthorityRegistry(authority), /must contain exactly/)
  })

  it("rejects duplicate outcome digests, authority references, and allowed nodes", () => {
    const outcomes = outcomeRegistry()
    outcomes.entries.push(clone(outcomes.entries[0]))
    expectRejected(() => validateShadowOutcomeRegistry(outcomes), /artifact_sha256 is duplicated/)

    const authorities = authorityRegistry()
    authorities.entries.push(clone(authorities.entries[0]))
    expectRejected(() => validateShadowAuthorityRegistry(authorities), /reference is duplicated/)

    const nodes = authorityRegistry()
    nodes.entries[0].allowed_canonical_nodes = ["omen", "omen"]
    expectRejected(() => validateShadowAuthorityRegistry(nodes), /contains duplicates/)
  })

  it("requires ACTIVE reviewed entries, valid commits, and canonical nodes", () => {
    const inactiveOutcome = outcomeRegistry()
    inactiveOutcome.entries[0].status = "PENDING"
    expectRejected(() => validateShadowOutcomeRegistry(inactiveOutcome), /status must be ACTIVE/)

    const inactiveAuthority = authorityRegistry()
    inactiveAuthority.entries[0].status = "REVOKED"
    expectRejected(() => validateShadowAuthorityRegistry(inactiveAuthority), /status must be ACTIVE/)

    const badCommit = outcomeRegistry()
    badCommit.entries[0].reviewed_commit = "d".repeat(39)
    expectRejected(() => validateShadowOutcomeRegistry(badCommit), /40-character Git commit/)

    const unknownNode = authorityRegistry()
    unknownNode.entries[0].allowed_canonical_nodes = ["unknown-node"]
    expectRejected(() => validateShadowAuthorityRegistry(unknownNode), /not a canonical execution node/)

    const unsortedNodes = authorityRegistry()
    unsortedNodes.entries[0].allowed_canonical_nodes = ["omen", "aegis"]
    expectRejected(() => validateShadowAuthorityRegistry(unsortedNodes), /must be sorted/)
  })

  it("accepts Azure as a canonical Fabric node", () => {
    const azureBytes = Buffer.from(`${canonicalizeJcs({ ...artifactValue, actual_target_node: "azure" })}\n`)
    const azureSha256 = crypto.createHash("sha256").update(azureBytes).digest("hex")
    const outcome = outcomeRegistry()
    outcome.entries[0].artifact_sha256 = azureSha256
    outcome.entries[0].actual_target_node = "azure"
    const authority = authorityRegistry()
    authority.entries[0].allowed_canonical_nodes = ["azure"]
    expect(validateShadowEvidenceTrust({
      artifactBytes: azureBytes,
      expectedArtifactSha256: azureSha256,
      retainedSourceSha256,
      outcomeRegistry: outcome,
      authorityRegistry: authority,
    }).actual_target_node).toBe("azure")
  })

  it("strictly validates authority timestamps and validity chronology", () => {
    const malformed = authorityRegistry()
    malformed.entries[0].valid_from = "2026-02-30T00:00:00.000Z"
    expectRejected(() => validateShadowAuthorityRegistry(malformed), /not a valid UTC timestamp/)

    const reversed = authorityRegistry()
    reversed.entries[0].expires_at = reversed.entries[0].valid_from
    expectRejected(() => validateShadowAuthorityRegistry(reversed), /must be after valid_from/)

    const expired = authorityRegistry()
    expired.entries[0].expires_at = artifactValue.authority_outcome.checked_at
    expectRejected(() => trust({ authorityRegistry: expired }), /outside the reviewed validity window/)
  })

  it("rejects every outcome registry semantic binding mismatch", () => {
    const mutations: Array<[RegExp, (registry: JsonObject) => void]> = [
      [/not present in the reviewed outcome registry/, (registry) => { registry.entries[0].artifact_sha256 = "d".repeat(64) }],
      [/Work Order binding mismatch/, (registry) => { registry.entries[0].work_order_id = "WO-OTHER-001" }],
      [/actual-node binding mismatch/, (registry) => { registry.entries[0].actual_target_node = "aegis" }],
      [/retained-source binding mismatch/, (registry) => { registry.entries[0].retained_source_sha256 = "e".repeat(64) }],
      [/authority-reference binding mismatch/, (registry) => { registry.entries[0].authority_reference = "authority-other-v1" }],
    ]
    for (const [detail, mutate] of mutations) {
      const registry = outcomeRegistry()
      mutate(registry)
      expectRejected(() => trust({ outcomeRegistry: registry }), detail)
    }
  })

  it("rejects missing or mismatched authority bindings", () => {
    const missing = authorityRegistry({ entries: [] })
    expectRejected(() => trust({ authorityRegistry: missing }), /empty or invalid trust registries/)

    const wrongWorkOrder = authorityRegistry()
    wrongWorkOrder.entries[0].work_order_id = "WO-OTHER-001"
    expectRejected(() => trust({ authorityRegistry: wrongWorkOrder }), /authority Work Order binding mismatch/)

    const wrongNode = authorityRegistry()
    wrongNode.entries[0].allowed_canonical_nodes = ["aegis"]
    expectRejected(() => trust({ authorityRegistry: wrongNode }), /actual target is not allowed/)

    const wrongReference = authorityRegistry()
    wrongReference.entries[0].reference = "authority-other-v1"
    expectRejected(() => trust({ authorityRegistry: wrongReference }), /authority reference is not present/)
  })

  it("revalidates normalized registry objects instead of trusting status claims", () => {
    const forgedOutcome = validateShadowOutcomeRegistry(outcomeRegistry()) as JsonObject
    forgedOutcome.entries[0].work_order_id = "WO-OTHER-001"
    expectRejected(() => trust({ outcomeRegistry: forgedOutcome }), /Work Order binding mismatch/)

    const forgedStatus = validateShadowAuthorityRegistry(authorityRegistry()) as JsonObject
    forgedStatus.status = "EMPTY_FAIL_CLOSED"
    expectRejected(() => trust({ authorityRegistry: forgedStatus }), /normalized status is inconsistent/)
  })

  it("authenticates exact outcome bytes before registry settlement", () => {
    const changed = Buffer.concat([artifactBytes.subarray(0, -1), Buffer.from(" \n")])
    expectRejected(() => trust({ artifactBytes: changed }), /outcome artifact validation failed.*SHA-256/)
    expectRejected(() => trust({ expectedArtifactSha256: "F".repeat(64) }), /outcome artifact validation failed.*lowercase/)
  })

  it("loads and validates explicitly supplied registry files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-evidence-trust-"))
    const outcomePath = path.join(root, "outcomes.json")
    const authorityPath = path.join(root, "authorities.json")
    fs.writeFileSync(outcomePath, `${JSON.stringify(outcomeRegistry(), null, 2)}\n`)
    fs.writeFileSync(authorityPath, `${JSON.stringify(authorityRegistry(), null, 2)}\n`)
    const loaded = loadShadowEvidenceTrustRegistries({
      outcomeRegistryPath: outcomePath,
      authorityRegistryPath: authorityPath,
    })
    fs.rmSync(root, { recursive: true, force: true })

    expect(loaded.outcome_registry.status).toBe("VALID")
    expect(loaded.authority_registry.status).toBe("VALID")
    expect(trust({
      outcomeRegistry: loaded.outcome_registry,
      authorityRegistry: loaded.authority_registry,
    }).status).toBe("TRUSTED")
  })
})
