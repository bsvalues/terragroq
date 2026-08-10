import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

import {
  DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY,
  DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG,
  digestBoundedDispatchTaskTemplate,
  loadBoundedDispatchAuthorityFiles,
  proveBoundedDispatchAuthorityFromGit,
  settleBoundedDispatchAuthority,
  validateBoundedDispatchAuthorityRegistry,
  validateBoundedDispatchTaskTemplateCatalog,
} from "../scripts/execution-fabric/bounded-dispatch-authority.mjs"

type JsonObject = Record<string, any>

const scopeCommit = "a".repeat(40)
const activationCommit = "b".repeat(40)
const authorityNonce = "phase3-single-use-0001"
const validFrom = "2026-08-10T18:00:00.000Z"
const expiresAt = "2026-08-10T19:00:00.000Z"
const evaluatedAt = "2026-08-10T18:30:00.000Z"

function readJson(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function catalog(): JsonObject {
  return readJson(path.resolve("config/execution-fabric/bounded-dispatch-task-templates.json"))
}

function templateDigest(): string {
  return digestBoundedDispatchTaskTemplate(catalog().templates[0])
}

function entry(overrides: JsonObject = {}): JsonObject {
  return {
    authority_reference: "phase3-hermes-bounded-dispatch-001",
    work_order_id: "WO-EF-PHASE3-001",
    scope_id: "issue-538-phase3-dispatch-001",
    scope_path: "config/execution-fabric/dispatch-authority-scopes/WO-EF-PHASE3-001.json",
    scope_sha256: "c".repeat(64),
    template_id: "hermes-loopback-local-inference-v1",
    template_version: "1.0.0",
    template_sha256: templateDigest(),
    selected_node: "hermes-node",
    valid_from: validFrom,
    expires_at: expiresAt,
    reviewed_scope_commit: scopeCommit,
    activation_commit: activationCommit,
    activation_evidence_path: "docs/reports/execution-fabric-dispatch-activations/WO-EF-PHASE3-001.json",
    activation_evidence_sha256: "d".repeat(64),
    nonce: authorityNonce,
    maximum_uses: 1,
    uses_consumed: 0,
    status: "ACTIVE",
    ...overrides,
  }
}

function registry(entries: JsonObject[] = [entry()]): JsonObject {
  return {
    schema_version: "0.1-bounded-dispatch-authority-registry",
    registry_id: "execution-fabric-bounded-dispatch-authorities",
    entries,
  }
}

function request(overrides: JsonObject = {}): JsonObject {
  return {
    authority_reference: "phase3-hermes-bounded-dispatch-001",
    work_order_id: "WO-EF-PHASE3-001",
    scope_id: "issue-538-phase3-dispatch-001",
    scope_sha256: "c".repeat(64),
    template_id: "hermes-loopback-local-inference-v1",
    template_version: "1.0.0",
    template_sha256: templateDigest(),
    selected_node: "hermes-node",
    nonce: authorityNonce,
    ...overrides,
  }
}

function settle(overrides: JsonObject = {}) {
  return settleBoundedDispatchAuthority({
    catalog: catalog(),
    registry: registry(),
    request: request(),
    at: evaluatedAt,
    ...overrides,
  }) as JsonObject
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function expectRejected(action: () => unknown, detail: RegExp) {
  expect(action).toThrowError(detail)
}

describe("Execution Fabric Phase 3 bounded-dispatch authority", () => {
  it("loads the exact reviewed template and initially empty fail-closed registry", () => {
    expect(DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG).toMatch(/bounded-dispatch-task-templates\.json$/)
    expect(DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY).toMatch(/bounded-dispatch-authority-registry\.json$/)
    const loaded = loadBoundedDispatchAuthorityFiles()

    expect(loaded.catalog).toMatchObject({ status: "VALID", scheduler_state: "OFF" })
    expect(loaded.catalog.templates).toEqual([expect.objectContaining({
      id: "hermes-loopback-local-inference-v1",
      version: "1.0.0",
      canonical_node: "hermes-node",
      workload_id: "local-llm-inference",
      model: "llama3.2:3b",
      prompt_sha256: "ab5bcd896d9617473a3cb8c84c04e2a247f68fb36a257717856acbae4e88a692",
      expected_marker: "HERMES_DISPATCH_001_OK",
      endpoint: "http://127.0.0.1:11434/api/generate",
      endpoint_scope: "loopback-only",
      maximum_calls: 1,
      timeout_seconds: 60,
      redirect_policy: "error",
      stream: false,
      protected_data_allowed: false,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
    })])
    expect(loaded.registry).toEqual({
      schema_version: "0.1-bounded-dispatch-authority-registry",
      registry_id: "execution-fabric-bounded-dispatch-authorities",
      status: "EMPTY_FAIL_CLOSED",
      entries: [],
    })
  })

  it("returns a non-executing fail-closed result for the empty activation registry", () => {
    const result = settleBoundedDispatchAuthority({
      catalog: catalog(),
      registry: readJson(DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY),
      request: request(),
      at: evaluatedAt,
    }) as JsonObject
    expect(result).toMatchObject({
      status: "BLOCKED_EMPTY_REGISTRY",
      authority_settled: false,
      eligible_for_single_shot_dispatch: false,
      maximum_calls: 0,
      scheduler_state: "OFF",
      network_called: false,
      execution_performed: false,
    })
  })

  it("settles only the exact active, unused, single-use activation", () => {
    expect(settle()).toMatchObject({
      status: "SINGLE_USE_AUTHORITY_SETTLED",
      authority_settled: true,
      eligible_for_single_shot_dispatch: true,
      authority_reference: "phase3-hermes-bounded-dispatch-001",
      work_order_id: "WO-EF-PHASE3-001",
      scope_id: "issue-538-phase3-dispatch-001",
      scope_sha256: "c".repeat(64),
      template_id: "hermes-loopback-local-inference-v1",
      template_version: "1.0.0",
      selected_node: "hermes-node",
      nonce: authorityNonce,
      maximum_calls: 1,
      uses_consumed: 0,
      scheduler_state: "OFF",
      network_called: false,
      execution_performed: false,
    })
    expect(settleBoundedDispatchAuthority({
      catalog: validateBoundedDispatchTaskTemplateCatalog(catalog()),
      registry: validateBoundedDispatchAuthorityRegistry(registry()),
      request: request(),
      at: evaluatedAt,
    }).status).toBe("SINGLE_USE_AUTHORITY_SETTLED")
  })

  it("rejects every exact template field mutation", () => {
    const mutations: Array<[string, (value: JsonObject) => void]> = [
      ["id", (value) => { value.id = "other-template" }],
      ["version", (value) => { value.version = "1.0.1" }],
      ["canonical_node", (value) => { value.canonical_node = "omen" }],
      ["workload_id", (value) => { value.workload_id = "other-workload" }],
      ["model", (value) => { value.model = "other:model" }],
      ["prompt_sha256", (value) => { value.prompt_sha256 = "f".repeat(64) }],
      ["expected_marker", (value) => { value.expected_marker = "OTHER_MARKER" }],
      ["endpoint", (value) => { value.endpoint = "http://127.0.0.1:11435/api/generate" }],
      ["endpoint_scope", (value) => { value.endpoint_scope = "lan" }],
      ["maximum_calls", (value) => { value.maximum_calls = 2 }],
      ["timeout_seconds", (value) => { value.timeout_seconds = 61 }],
      ["redirect_policy", (value) => { value.redirect_policy = "follow" }],
      ["stream", (value) => { value.stream = true }],
      ["data_classification", (value) => { value.data_classification = "protected" }],
      ["protected_data_allowed", (value) => { value.protected_data_allowed = true }],
      ["execution_mode", (value) => { value.execution_mode = "ARBITRARY" }],
      ["scheduler_state", (value) => { value.scheduler_state = "ON" }],
      ["autonomous_dispatch", (value) => { value.autonomous_dispatch = true }],
      ["maximum_gpu_vram_bytes", (value) => { value.resource_ceilings.maximum_gpu_vram_bytes += 1 }],
      ["prompt_limit_bytes", (value) => { value.resource_ceilings.prompt_limit_bytes += 1 }],
      ["response_limit_bytes", (value) => { value.resource_ceilings.response_limit_bytes += 1 }],
    ]
    for (const [label, mutate] of mutations) {
      const changed = catalog()
      mutate(changed.templates[0])
      expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(changed), /must be exactly|must contain only/)
      expect(label).toBeTruthy()
    }
  })

  it("rejects missing, extra, duplicate, and unreviewed templates", () => {
    const missing = catalog()
    delete missing.templates[0].model
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(missing), /must contain exactly/)
    const extra = catalog()
    extra.templates[0].extra = true
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(extra), /must contain exactly/)
    const duplicate = catalog()
    duplicate.templates.push(clone(duplicate.templates[0]))
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(duplicate), /duplicate ID\/version/)
    const unreviewed = catalog()
    unreviewed.templates.push({ ...clone(unreviewed.templates[0]), id: "z-other-template" })
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(unreviewed), /must contain only the reviewed/)
  })

  it("binds the template digest deterministically and detects catalog tampering", () => {
    const first = catalog().templates[0]
    const reordered = Object.fromEntries(Object.entries(first).reverse())
    reordered.resource_ceilings = Object.fromEntries(Object.entries(first.resource_ceilings).reverse())
    expect(digestBoundedDispatchTaskTemplate(first)).toBe(digestBoundedDispatchTaskTemplate(reordered))
    expect(digestBoundedDispatchTaskTemplate(first)).toMatch(/^[a-f0-9]{64}$/)

    const changedCatalog = catalog()
    changedCatalog.templates[0].prompt_sha256 = "f".repeat(64)
    expectRejected(() => settle({ catalog: changedCatalog }), /must be exactly/)
  })

  it("binds the exact UTF-8 prompt bytes including one trailing LF", () => {
    const promptBytes = Buffer.from("Reply with exactly HERMES_DISPATCH_001_OK and nothing else.\n", "utf8")
    expect(promptBytes).toHaveLength(60)
    expect(crypto.createHash("sha256").update(promptBytes).digest("hex"))
      .toBe(catalog().templates[0].prompt_sha256)
  })

  it("validates exact, sorted, unique, bounded registry entries", () => {
    expect(validateBoundedDispatchAuthorityRegistry(registry()).status).toBe("VALID")
    const extra = registry()
    extra.entries[0].extra = true
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(extra), /must contain exactly/)
    const duplicateReference = registry([
      entry(),
      entry({ nonce: "phase3-single-use-0002" }),
    ])
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(duplicateReference), /duplicate authority references/)
    const duplicateNonce = registry([
      entry({ authority_reference: "phase3-authority-001" }),
      entry({ authority_reference: "phase3-authority-002" }),
    ])
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(duplicateNonce), /duplicate nonces/)
    const unsorted = registry([
      entry({ authority_reference: "phase3-authority-z", nonce: "phase3-single-use-0002" }),
      entry({ authority_reference: "phase3-authority-a", nonce: "phase3-single-use-0003" }),
    ])
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(unsorted), /must be sorted/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry(
      Array.from({ length: 65 }, (_, index) => entry({
        authority_reference: `phase3-authority-${String(index).padStart(2, "0")}`,
        nonce: `phase3-single-use-${String(index).padStart(4, "0")}`,
      })),
    )), /64-entry bound/)
  })

  it("rejects malformed chronology, commits, nonce, and use limits", () => {
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ expires_at: validFrom })])), /must be after/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ expires_at: "2026-08-12T18:00:00.000Z" })])), /exceeds 24 hours/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ valid_from: "2026-02-30T00:00:00.000Z" })])), /not a valid UTC timestamp/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ reviewed_scope_commit: "a".repeat(39) })])), /40-character Git commit/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ activation_commit: scopeCommit })])), /must be separate/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ nonce: "short" })])), /safe nonce/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ maximum_uses: 2 })])), /must be exactly 1/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ uses_consumed: 2 })])), /must be 0 or 1/)
  })

  it("rejects activation entries for an unreviewed template or non-HERMES node", () => {
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({
      template_id: "other-template",
    })])), /template_id must be exactly/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({
      template_version: "2.0.0",
    })])), /template_version must be exactly/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({
      selected_node: "omen",
    })])), /selected_node must be exactly/)
  })

  it("rejects stale, expired, revoked, and consumed authority", () => {
    expectRejected(() => settle({ at: "2026-08-10T17:59:59.999Z" }), /not yet valid/)
    expectRejected(() => settle({ at: expiresAt }), /expired/)
    expectRejected(() => settle({ registry: registry([entry({ status: "REVOKED" })]) }), /not active: REVOKED/)
    expectRejected(() => settle({ registry: registry([entry({ status: "CONSUMED", uses_consumed: 1 })]) }), /not active: CONSUMED/)
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(registry([entry({ status: "ACTIVE", uses_consumed: 1 })])), /must be unused/)
  })

  it("rejects wrong authority, work order, template, digest, node, and nonce bindings", () => {
    const mutations: Array<[RegExp, JsonObject]> = [
      [/not present/, { authority_reference: "phase3-missing-authority" }],
      [/work_order_id does not match/, { work_order_id: "WO-OTHER-001" }],
      [/scope_id does not match/, { scope_id: "other-scope" }],
      [/scope_sha256 does not match/, { scope_sha256: "e".repeat(64) }],
      [/template ID\/version is not present/, { template_id: "other-template" }],
      [/template ID\/version is not present/, { template_version: "9.0.0" }],
      [/template_sha256 does not match/, { template_sha256: "f".repeat(64) }],
      [/selected_node does not match/, { selected_node: "omen" }],
      [/nonce does not match/, { nonce: "phase3-single-use-9999" }],
    ]
    for (const [detail, overrides] of mutations) {
      expectRejected(() => settle({ request: request(overrides) }), detail)
    }
  })

  it("rejects executable and secret-like fields or values at every boundary", () => {
    const executableCatalog = catalog()
    executableCatalog.templates[0].command = "ollama run llama3.2:3b"
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(executableCatalog), /executable-like field/)
    const secretCatalog = catalog()
    secretCatalog.templates[0].expected_marker = `ghp_${"a".repeat(36)}`
    expectRejected(() => validateBoundedDispatchTaskTemplateCatalog(secretCatalog), /secret-like material/)
    const executableRegistry = registry()
    executableRegistry.entries[0].script = "ignored"
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(executableRegistry), /executable-like field/)
    const secretRegistry = registry()
    secretRegistry.entries[0].api_token = "not-a-token"
    expectRejected(() => validateBoundedDispatchAuthorityRegistry(secretRegistry), /secret-like field/)
    expectRejected(() => settle({ request: request({ command: "ignored" }) }), /executable-like field/)
    expectRejected(() => settle({ request: request({ work_order_id: `Bearer ${"a".repeat(24)}` }) }), /secret-like material/)
  })

  it("does not expose an execution, network, scheduler, or mutation adapter", () => {
    const source = fs.readFileSync(path.resolve("scripts/execution-fabric/bounded-dispatch-authority.mjs"), "utf8")
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/https?\.request\s*\(/)
    expect(source).not.toMatch(/writeFile(?:Sync)?\s*\(/)
    expect(settle()).toMatchObject({
      scheduler_state: "OFF",
      network_called: false,
      execution_performed: false,
    })
  })

  it("proves exact reviewed scope and later activation bytes on trusted main", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-authority-git-"))
    const run = (...args: string[]) => {
      const result = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" },
      })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    try {
      run("init", "-b", "main")
      const scopePath = "config/execution-fabric/dispatch-authority-scopes/WO-EF-PHASE3-001.json"
      const activationPath = "docs/reports/execution-fabric-dispatch-activations/WO-EF-PHASE3-001.json"
      const scopeValue = {
        schema_version: "0.1-bounded-dispatch-scope",
        scope_id: "issue-538-phase3-dispatch-001",
        work_order_id: "WO-EF-PHASE3-001",
        risk_class: "R0_LOCAL_PROOF",
        template_id: "hermes-loopback-local-inference-v1",
        template_version: "1.0.0",
        template_sha256: templateDigest(),
        selected_node: "hermes-node",
        workload_id: "gpu-local-inference",
        allowed_actions: ["invoke-fixed-hermes-loopback-inference", "retain-sanitized-completion-evidence"],
        forbidden_actions: ["aegis-execution", "arbitrary-shell", "autonomous-scheduling", "external-provider-access", "protected-data-access", "remote-system-mutation", "silent-replacement", "state-write"],
        maximum_calls: 1,
        timeout_seconds: 60,
        data_classification: "non-sensitive-only",
        protected_data_allowed: false,
        storage_semantics: "none",
        network_scope: "loopback-only",
        scheduler_state: "OFF",
        autonomous_dispatch: false,
        activation_state: "REVIEWED_SCOPE_ONLY_NOT_ACTIVE",
      }
      const scopeBytes = Buffer.from(`${JSON.stringify(scopeValue)}\n`)
      fs.mkdirSync(path.dirname(path.join(root, scopePath)), { recursive: true })
      fs.writeFileSync(path.join(root, scopePath), scopeBytes)
      run("add", scopePath); run("commit", "-m", "scope")
      const reviewedScopeCommit = run("rev-parse", "HEAD")
      const scopeSha256 = crypto.createHash("sha256").update(scopeBytes).digest("hex")
      const activationValue = {
        schema_version: "0.1-bounded-dispatch-activation-evidence",
        authority_reference: "phase3-hermes-bounded-dispatch-001",
        work_order_id: "WO-EF-PHASE3-001",
        scope_id: "issue-538-phase3-dispatch-001",
        scope_sha256: scopeSha256,
        template_sha256: templateDigest(),
        selected_node: "hermes-node",
        valid_from: validFrom,
        expires_at: expiresAt,
        reviewed_scope_commit: reviewedScopeCommit,
        nonce: authorityNonce,
        maximum_uses: 1,
        status: "REVIEWED_ACTIVATION_EVIDENCE",
        scheduler_state: "OFF",
        autonomous_dispatch: false,
      }
      const activationBytes = Buffer.from(`${JSON.stringify(activationValue)}\n`)
      fs.mkdirSync(path.dirname(path.join(root, activationPath)), { recursive: true })
      fs.writeFileSync(path.join(root, activationPath), activationBytes)
      run("add", activationPath); run("commit", "-m", "activation")
      const activationCommitValue = run("rev-parse", "HEAD")
      fs.writeFileSync(path.join(root, "trusted.txt"), "trusted\n")
      run("add", "trusted.txt"); run("commit", "-m", "trusted main")
      const scopedEntry = entry({
        reviewed_scope_commit: reviewedScopeCommit,
        activation_commit: activationCommitValue,
        scope_path: scopePath,
        scope_sha256: scopeSha256,
        activation_evidence_path: activationPath,
        activation_evidence_sha256: crypto.createHash("sha256").update(activationBytes).digest("hex"),
      })
      const settlement = settleBoundedDispatchAuthority({
        catalog: catalog(),
        registry: registry([scopedEntry]),
        request: request({ scope_sha256: scopedEntry.scope_sha256 }),
        at: evaluatedAt,
      })
      expect(proveBoundedDispatchAuthorityFromGit({ repositoryRoot: root, settlement, trustedRef: "refs/heads/main" }))
        .toMatchObject({ status: "TRUSTED_MAIN_AUTHORITY_PROVEN", scheduler_state: "OFF", execution_performed: false })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
