import crypto from "node:crypto"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  digestShadowAuthorityScope,
  validateShadowAuthorityScope,
} from "../scripts/execution-fabric/shadow-authority-scope.mjs"

type JsonObject = Record<string, any>

const workloadDigest = "1".repeat(64)
const templateDigest = "2".repeat(64)

function scope(overrides: JsonObject = {}): JsonObject {
  return {
    schema_version: "0.2-shadow-authority-scope",
    authority_reference: "issue-538-phase2-shadow-002",
    work_order_id: "WO-EF-SHADOW-002",
    workload: { id: "bounded-loopback-inference", contract_sha256: workloadDigest },
    risk_class: "R0",
    task_template: { id: "existing-loopback-llm-inference-v1", contract_sha256: templateDigest },
    repository_scope: ["bsvalues/terragroq"],
    environment_scope: ["hermes-loopback-ollama"],
    allowed_actions: ["invoke the existing loopback LLM", "read one bounded response"],
    forbidden_actions: ["inspect secrets", "mutate model inventory", "read protected data"],
    data_classification: "non-sensitive only",
    owner_decision_conditions: ["new authority boundary"],
    allowed_canonical_nodes: ["hermes-node"],
    ...overrides,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function expectRejected(value: unknown, detail: RegExp) {
  expect(() => validateShadowAuthorityScope(value)).toThrowError(detail)
}

describe("Execution Fabric shadow authority scope 0.2", () => {
  it("validates and normalizes the exact canonical contract without mutating input", () => {
    const input = scope()
    const before = clone(input)
    const validated = validateShadowAuthorityScope(input)

    expect(input).toEqual(before)
    expect(validated).toEqual(before)
    expect(validated).not.toBe(input)
    expect(validated.workload).not.toBe(input.workload)
    expect(validated.allowed_actions).not.toBe(input.allowed_actions)
  })

  it("rejects every missing top-level field", () => {
    for (const field of Object.keys(scope())) {
      const changed = scope()
      delete changed[field]
      expectRejected(changed, /must contain exactly/)
    }
  })

  it("rejects extra top-level and nested fields", () => {
    expectRejected(scope({ extra: true }), /must contain exactly/)
    const changedWorkload = scope()
    changedWorkload.workload.extra = true
    expectRejected(changedWorkload, /scope\.workload must contain exactly/)
    const changedTemplate = scope()
    changedTemplate.task_template.command = "ignored"
    expectRejected(changedTemplate, /executable-like field/)
  })

  it("rejects unsupported schema versions and risk classes", () => {
    expectRejected(scope({ schema_version: "0.1-shadow-authority-scope" }), /schema_version is unsupported/)
    for (const risk of ["R2", "r0", "", null]) expectRejected(scope({ risk_class: risk }), /must be R0 or R1/)
    expect(validateShadowAuthorityScope(scope({ risk_class: "R1" })).risk_class).toBe("R1")
  })

  it("rejects malformed identifiers and contract digests", () => {
    for (const field of ["authority_reference", "work_order_id"]) {
      expectRejected(scope({ [field]: "unsafe id" }), /safe identifier/)
    }
    for (const field of ["workload", "task_template"]) {
      const badId = scope()
      badId[field].id = "unsafe/id"
      expectRejected(badId, /safe identifier/)
      const uppercase = scope()
      uppercase[field].contract_sha256 = "A".repeat(64)
      expectRejected(uppercase, /lowercase SHA-256/)
      const short = scope()
      short[field].contract_sha256 = "a".repeat(63)
      expectRejected(short, /lowercase SHA-256/)
    }
  })

  it("rejects empty, oversized, duplicate, and unsorted arrays", () => {
    const arrayFields = [
      "repository_scope",
      "environment_scope",
      "allowed_actions",
      "forbidden_actions",
      "owner_decision_conditions",
      "allowed_canonical_nodes",
    ]
    for (const field of arrayFields) {
      expectRejected(scope({ [field]: [] }), /non-empty array/)
      expectRejected(scope({ [field]: Array.from({ length: 65 }, (_, index) => `item-${String(index).padStart(2, "0")}`) }), /64-item bound/)
      expectRejected(scope({ [field]: ["same", "same"] }), /duplicates|governed canonical/)
      expectRejected(scope({ [field]: ["z-value", "a-value"] }), /must be sorted|governed canonical/)
    }
  })

  it("rejects unsafe or non-normalized strings", () => {
    expectRejected(scope({ data_classification: " non-sensitive" }), /NFC-normalized and trimmed/)
    expectRejected(scope({ repository_scope: ["repo\nname"] }), /control or format/)
    expectRejected(scope({ environment_scope: ["e\u0301"] }), /NFC-normalized and trimmed/)
    expectRejected(scope({ owner_decision_conditions: ["x".repeat(257)] }), /no longer than 256/)
    expectRejected(scope({ allowed_actions: [42] }), /must be a non-empty string/)
  })

  it("requires allowed and forbidden actions to be disjoint", () => {
    expectRejected(scope({
      allowed_actions: ["read metadata"],
      forbidden_actions: ["read metadata"],
    }), /must be disjoint/)
    expectRejected(scope({
      allowed_actions: ["READ METADATA"],
      forbidden_actions: ["read metadata"],
    }), /must be disjoint/)
  })

  it("accepts only governed canonical nodes", () => {
    expect(validateShadowAuthorityScope(scope({
      allowed_canonical_nodes: ["aegis", "atlas", "azure", "hermes-node", "omen"],
    })).allowed_canonical_nodes).toHaveLength(5)
    expectRejected(scope({ allowed_canonical_nodes: ["atlas", "atlas"] }), /contains duplicates/)
    expectRejected(scope({ allowed_canonical_nodes: ["omen", "atlas"] }), /must be sorted/)
    expectRejected(scope({ allowed_canonical_nodes: ["unknown-node"] }), /not a governed canonical execution node/)
  })

  it("rejects executable and secret-like fields or values recursively", () => {
    expectRejected(scope({ command: "run build" }), /executable-like field/)
    expectRejected(scope({ api_token: "not-even-a-token" }), /secret-like field/)
    expectRejected(scope({ data_classification: "bash ./collect.sh" }), /executable-like material/)
    expectRejected(scope({ owner_decision_conditions: [`Bearer ${"a".repeat(24)}`] }), /secret-like material/)
    expectRejected(scope({ authority_reference: `ghp_${"a".repeat(36)}` }), /secret-like material/)
  })

  it("hashes UTF8(JCS(scope) plus newline) deterministically", () => {
    const value = scope()
    const reordered = Object.fromEntries(Object.entries(value).reverse())
    reordered.workload = { contract_sha256: workloadDigest, id: "bounded-loopback-inference" }
    const expected = crypto.createHash("sha256")
      .update(Buffer.from(`${canonicalizeJcs(value)}\n`, "utf8"))
      .digest("hex")
    const withoutNewline = crypto.createHash("sha256")
      .update(Buffer.from(canonicalizeJcs(value), "utf8"))
      .digest("hex")

    expect(digestShadowAuthorityScope(value)).toBe(expected)
    expect(digestShadowAuthorityScope(reordered)).toBe(expected)
    expect(digestShadowAuthorityScope(value)).not.toBe(withoutNewline)
    expect(digestShadowAuthorityScope(value)).toMatch(/^[a-f0-9]{64}$/)
  })

  it("changes the digest for every bound field mutation", () => {
    const base = scope()
    const baseDigest = digestShadowAuthorityScope(base)
    const mutations: Array<[string, (value: JsonObject) => void]> = [
      ["authority_reference", (value) => { value.authority_reference = "issue-538-phase2-shadow-003" }],
      ["work_order_id", (value) => { value.work_order_id = "WO-EF-SHADOW-003" }],
      ["workload.id", (value) => { value.workload.id = "forge-root-metadata-query" }],
      ["workload.contract_sha256", (value) => { value.workload.contract_sha256 = "3".repeat(64) }],
      ["risk_class", (value) => { value.risk_class = "R1" }],
      ["task_template.id", (value) => { value.task_template.id = "forge-root-metadata-query-v1" }],
      ["task_template.contract_sha256", (value) => { value.task_template.contract_sha256 = "4".repeat(64) }],
      ["repository_scope", (value) => { value.repository_scope = ["bsvalues/other"] }],
      ["environment_scope", (value) => { value.environment_scope = ["atlas-forge-root-read-only"] }],
      ["allowed_actions", (value) => { value.allowed_actions = ["read Forge-root metadata"] }],
      ["forbidden_actions", (value) => { value.forbidden_actions = ["mutate database"] }],
      ["data_classification", (value) => { value.data_classification = "non-sensitive metadata only" }],
      ["owner_decision_conditions", (value) => { value.owner_decision_conditions = ["new protected-data authority"] }],
      ["allowed_canonical_nodes", (value) => { value.allowed_canonical_nodes = ["atlas"] }],
    ]

    for (const [label, mutate] of mutations) {
      const changed = clone(base)
      mutate(changed)
      expect(digestShadowAuthorityScope(changed), label).not.toBe(baseDigest)
    }
  })
})
