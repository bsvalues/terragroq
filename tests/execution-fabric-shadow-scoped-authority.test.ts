import crypto from "node:crypto"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import { digestShadowAuthorityScope } from "../scripts/execution-fabric/shadow-authority-scope.mjs"
import {
  digestScopedAuthorityActivationEntry,
  settleScopedShadowAuthority,
  validateScopedShadowAuthorityRegistry,
  validateShadowAuthorityArtifact,
} from "../scripts/execution-fabric/shadow-scoped-authority.mjs"

const hash = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex")
const scope = () => ({
  schema_version: "0.2-shadow-authority-scope",
  authority_reference: "issue-538-phase2-shadow-002",
  work_order_id: "WO-EF-SHADOW-002",
  workload: { id: "local-llm-inference", contract_sha256: "1".repeat(64) },
  risk_class: "R0",
  task_template: { id: "loopback-inference-v1", contract_sha256: "2".repeat(64) },
  repository_scope: ["bsvalues/terragroq"],
  environment_scope: ["hermes-loopback-ollama"],
  allowed_actions: ["invoke bounded inference"],
  forbidden_actions: ["inspect secrets", "mutate runtime"],
  data_classification: "non-sensitive",
  owner_decision_conditions: ["new authority boundary"],
  allowed_canonical_nodes: ["hermes-node"],
})

function fixture() {
  const value = scope()
  const bytes = Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8")
  const artifactSha = hash(bytes)
  const entry = {
    reference: value.authority_reference,
    work_order_id: value.work_order_id,
    authority_artifact_path: `docs/reports/execution-fabric-shadow-authorities/${value.authority_reference}.json`,
    authority_artifact_sha256: artifactSha,
    authority_scope_sha256: digestShadowAuthorityScope(value),
    scope_review_commit: "a".repeat(40),
    valid_from: "2026-08-10T16:00:00.000Z",
    expires_at: "2026-08-10T18:00:00.000Z",
    status: "ACTIVE",
  }
  return { value, bytes, entry }
}

const settle = (overrides: Record<string, any> = {}) => {
  const selected = fixture()
  return settleScopedShadowAuthority({
    entry: selected.entry,
    artifactBytes: selected.bytes,
    checkedAt: "2026-08-10T16:30:00.000Z",
    workOrderId: "WO-EF-SHADOW-002",
    workloadId: "local-llm-inference",
    workloadContractSha256: "1".repeat(64),
    nodeId: "hermes-node",
    scopeProof: { trusted_ref: "refs/heads/main", artifact_sha256: selected.entry.authority_artifact_sha256, reviewed_commit: "a".repeat(40) },
    activationProof: { trusted_ref: "refs/heads/main", activation_commit: "b".repeat(40), entry_sha256: digestScopedAuthorityActivationEntry(selected.entry) },
    ...overrides,
  })
}

describe("Execution Fabric scoped shadow authority", () => {
  it("validates exact canonical artifact bytes and digest", () => {
    const selected = fixture()
    expect(validateShadowAuthorityArtifact({ artifactBytes: selected.bytes, expectedSha256: selected.entry.authority_artifact_sha256 }))
      .toMatchObject({ status: "VALID", authority_scope_sha256: selected.entry.authority_scope_sha256 })
    const pretty = Buffer.from(`${JSON.stringify(selected.value, null, 2)}\n`)
    expect(() => validateShadowAuthorityArtifact({ artifactBytes: pretty, expectedSha256: hash(pretty) })).toThrow(/exact JCS/)
  })

  it("validates a separate fail-closed activation registry", () => {
    const { entry } = fixture()
    expect(validateScopedShadowAuthorityRegistry({ schema_version: "0.2-shadow-authority-registry", registry_id: "scoped-authorities", entries: [entry] }))
      .toMatchObject({ status: "VALID", entries: [{ reference: entry.reference }] })
    expect(validateScopedShadowAuthorityRegistry({ schema_version: "0.2-shadow-authority-registry", registry_id: "scoped-authorities", entries: [] }).status)
      .toBe("EMPTY_FAIL_CLOSED")
  })

  it("settles artifact, scope, Work Order, workload, node, window, and both Git proofs", () => {
    expect(settle()).toMatchObject({
      status: "AUTHORIZED",
      authority_scope_sha256: fixture().entry.authority_scope_sha256,
      scope_review_commit: "a".repeat(40),
      authority_activation_commit: "b".repeat(40),
    })
  })

  it("rejects every cross-artifact binding mismatch", () => {
    const selected = fixture()
    for (const [label, overrides] of [
      ["scope", { entry: { ...selected.entry, authority_scope_sha256: "d".repeat(64) } }],
      ["work order", { workOrderId: "WO-EF-SHADOW-003" }],
      ["workload", { workloadId: "different-workload" }],
      ["workload contract", { workloadContractSha256: "e".repeat(64) }],
      ["node", { nodeId: "atlas" }],
      ["window", { checkedAt: "2026-08-10T18:00:00.000Z" }],
      ["scope proof", { scopeProof: { trusted_ref: "refs/heads/main", artifact_sha256: selected.entry.authority_artifact_sha256, reviewed_commit: "f".repeat(40) } }],
      ["activation proof", { activationProof: { trusted_ref: "refs/heads/dev", activation_commit: "b".repeat(40), entry_sha256: digestScopedAuthorityActivationEntry(selected.entry) } }],
      ["activation entry", { activationProof: { trusted_ref: "refs/heads/main", activation_commit: "b".repeat(40), entry_sha256: "c".repeat(64) } }],
    ] as Array<[string, Record<string, any>]>) {
      expect(() => settle(overrides), label).toThrow()
    }
  })
})
