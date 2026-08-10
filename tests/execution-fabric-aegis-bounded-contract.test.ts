import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import { evaluateResidentAegisContract } from "../scripts/execution-fabric/bounded-dispatch/resident-aegis-contract.mjs"

const permissionPath = "config/execution-fabric/agent-forge-aegis-bounded-dispatch-permission.json"
const contractPath = "config/execution-fabric/aegis-bounded-dispatch-contract.json"
const profilesPath = "config/execution-fabric/aegis-bounded-operation-profiles.json"
const manifestPath = "docs/reports/bounded-dispatch/aegis-inputs/test-input.json"
const permissionSha256 = "9a9cb0584b23a11d00064f70e1ca8d8f126b00d5bae607396d68b925741a49c1"

function digest(value: crypto.BinaryLike = "evidence") {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-bounded-contract-"))
  for (const relativePath of [permissionPath, contractPath, profilesPath]) {
    const destination = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(process.cwd(), relativePath), destination)
  }
  const manifest = `${JSON.stringify({
    schema_version: "0.1-aegis-input-manifest",
    manifest_id: "test-input",
    repository: "bsvalues/terragroq",
    source_commit: "a".repeat(40),
    entries: [{ path: "package.json", sha256: digest("package"), size_bytes: 128 }],
  }, null, 2)}\n`
  const manifestDestination = path.join(root, manifestPath)
  fs.mkdirSync(path.dirname(manifestDestination), { recursive: true })
  fs.writeFileSync(manifestDestination, manifest)
  return root
}

function request(templateId = "aegis.ci-build-test.v1") {
  const inputs: Record<string, object> = {
    "aegis.ci-build-test.v1": { profile_id: "williamos.standard-validation.v1" },
    "aegis.hash-verify.v1": {
      profile_id: "sha256.verify.v1",
      expected_aggregate_sha256: digest("aggregate"),
    },
    "aegis.compression.v1": {
      profile_id: "tar-zstd.deterministic.v1",
    },
  }
  return {
    schema_version: "0.1-aegis-bounded-dispatch-request",
    request_id: `request-${templateId}`,
    work_order_id: "WO-EF-AEGIS-CONTRACT-001",
    template_id: templateId,
    selected_node_id: "aegis",
    placement_receipt_sha256: digest("placement"),
    declared_source: {
      repository: "bsvalues/terragroq",
      commit_sha: "a".repeat(40),
      source_tree_sha256: digest("tree"),
    },
    input_manifest: {
      path: manifestPath,
      sha256: digest(`${JSON.stringify({
        schema_version: "0.1-aegis-input-manifest",
        manifest_id: "test-input",
        repository: "bsvalues/terragroq",
        source_commit: "a".repeat(40),
        entries: [{ path: "package.json", sha256: digest("package"), size_bytes: 128 }],
      }, null, 2)}\n`),
    },
    input: inputs[templateId],
    limits: {
      cpu_threads: 12,
      memory_bytes: 8589934592,
      timeout_ms: 1800000,
      output_bytes: 536870912,
      written_bytes: 5368709120,
    },
    forge: {
      producer_identity: "resident-aegis",
      permission_set_sha256: permissionSha256,
    },
  }
}

function rewrite(root: string, relativePath: string, mutate: (value: any) => void) {
  const target = path.join(root, relativePath)
  const value = JSON.parse(fs.readFileSync(target, "utf8"))
  mutate(value)
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`)
}

describe("Execution Fabric non-active AEGIS bounded adapter contract", () => {
  it.each([
    ["aegis.ci-build-test.v1", "CI_BUILD_TEST"],
    ["aegis.hash-verify.v1", "HASH_VERIFY"],
    ["aegis.compression.v1", "COMPRESSION"],
  ])("accepts the reviewed %s request only as a non-active contract", (templateId, workloadClass) => {
    const result = evaluateResidentAegisContract({ repositoryRoot: fixture(), request: request(templateId) })
    expect(result).toMatchObject({
      status: "NON_ACTIVE_REQUEST_SHAPE_VALID",
      template_id: templateId,
      workload_class: workloadClass,
      selected_node_id: "aegis",
      execution_authorized: false,
      dispatch_allowed: false,
      scheduler_activated: false,
      autonomous_dispatch: false,
      storage_nas_backup_authority_granted: false,
      remote_systems_modified: false,
      source_proven: false,
      placement_proven: false,
    })
    expect(result.request_sha256).toBe(digest(canonicalizeJcs(request(templateId))))
  })

  it("binds the exact reviewed permission bytes", () => {
    const root = fixture()
    rewrite(root, permissionPath, (value) => value.maximum_concurrency = 2)
    expect(evaluateResidentAegisContract({ repositoryRoot: root, request: request() })).toMatchObject({
      status: "INPUT_REJECTED",
      reasons: [{ code: "FORGE_PERMISSION_MISMATCH" }],
    })
  })

  it("pins permission and operation-profile digests outside the mutable contract", () => {
    const changedPermission = fixture()
    rewrite(changedPermission, contractPath, (value) => value.forge_permission_sha256 = digest("replacement-permission"))
    const permissionRequest = request()
    permissionRequest.forge.permission_set_sha256 = digest("replacement-permission")
    expect(evaluateResidentAegisContract({ repositoryRoot: changedPermission, request: permissionRequest }).status).toBe("INPUT_REJECTED")

    const changedProfiles = fixture()
    rewrite(changedProfiles, contractPath, (value) => value.operation_profiles_sha256 = digest("replacement-profiles"))
    expect(evaluateResidentAegisContract({ repositoryRoot: changedProfiles, request: request() }).status).toBe("INPUT_REJECTED")
  })

  it("binds exact operation-profile and input-manifest bytes", () => {
    const changedProfiles = fixture()
    rewrite(changedProfiles, profilesPath, (value) => value.profiles[0].network_scope = "outbound")
    expect(evaluateResidentAegisContract({ repositoryRoot: changedProfiles, request: request() }).status).toBe("INPUT_REJECTED")

    const changedManifest = fixture()
    rewrite(changedManifest, manifestPath, (value) => value.entries[0].size_bytes = 129)
    expect(evaluateResidentAegisContract({ repositoryRoot: changedManifest, request: request() })).toMatchObject({
      status: "INPUT_REJECTED",
      reasons: [{ code: "INPUT_MANIFEST_INVALID" }],
    })
  })

  it("rejects manifest traversal, duplicate paths, source drift, and excessive declared bytes", () => {
    const mutations = [
      (value: any) => value.entries[0].path = "../escape",
      (value: any) => value.entries.push({ ...value.entries[0] }),
      (value: any) => value.source_commit = "b".repeat(40),
      (value: any) => value.entries[0].size_bytes = 5368709121,
    ]
    for (const mutate of mutations) {
      const root = fixture()
      rewrite(root, manifestPath, mutate)
      const candidate = request()
      candidate.input_manifest.sha256 = digest(fs.readFileSync(path.join(root, manifestPath)))
      expect(evaluateResidentAegisContract({ repositoryRoot: root, request: candidate }).status).toBe("INPUT_REJECTED")
    }
  })

  it("fails closed on identity, authority, workspace, or ceiling drift", () => {
    for (const mutate of [
      (value: any) => value.machine_identity_sha256 = digest("different-machine"),
      (value: any) => value.execution_authorized = true,
      (value: any) => value.workspace.root = "/tmp",
      (value: any) => value.resource_ceilings.maximum_cpu_threads = 28,
      (value: any) => value.prohibited_paths.pop(),
    ]) {
      const root = fixture()
      rewrite(root, contractPath, mutate)
      expect(evaluateResidentAegisContract({ repositoryRoot: root, request: request() }).status).toBe("INPUT_REJECTED")
    }
  })

  it("rejects alternate nodes, templates, repositories, unsafe fields, and over-limit requests", () => {
    const changes = [
      (value: any) => value.selected_node_id = "hermes-node",
      (value: any) => value.template_id = "aegis.arbitrary.v1",
      (value: any) => value.declared_source.repository = "foreign/repository",
      (value: any) => value.input.command = "rm -rf /",
      (value: any) => value.limits.cpu_threads = 13,
      (value: any) => value.limits.memory_bytes = 8589934593,
      (value: any) => value.forge.producer_identity = "caller",
      (value: any) => value.request_id = "AKIAABCDEFGHIJKLMNOP",
      (value: any) => value.request_id = "xoxb-1234567890-abcdefghijklmnop",
    ]
    for (const change of changes) {
      const candidate = request()
      change(candidate)
      expect(evaluateResidentAegisContract({ repositoryRoot: fixture(), request: candidate }).status).toBe("INPUT_REJECTED")
    }
  })

  it("rejects changed hash and compression semantics", () => {
    const hash = request("aegis.hash-verify.v1")
    hash.input.profile_id = "md5.verify.v1"
    const compression = request("aegis.compression.v1")
    compression.input.profile_id = "tar-zstd.nondeterministic.v1"
    expect(evaluateResidentAegisContract({ repositoryRoot: fixture(), request: hash }).status).toBe("INPUT_REJECTED")
    expect(evaluateResidentAegisContract({ repositoryRoot: fixture(), request: compression }).status).toBe("INPUT_REJECTED")
  })

  it("adds no AEGIS activation and contains no execution or network primitive", () => {
    const authorities = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), "config/execution-fabric/bounded-dispatch-authority-registry.json"),
      "utf8",
    ))
    expect(authorities.entries.some((entry: any) => entry.selected_node_id === "aegis")).toBe(false)
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/execution-fabric/bounded-dispatch/resident-aegis-contract.mjs"),
      "utf8",
    )
    expect(source).not.toMatch(/from ["']node:child_process|\b(?:spawn|spawnSync|execFile|execSync)\s*\(|\bfetch\s*\(|\bssh\s/)
  })

  it("rejects symlink substitution of a reviewed trust artifact", () => {
    const root = fixture()
    const target = path.join(root, permissionPath)
    const moved = `${target}.real`
    fs.renameSync(target, moved)
    fs.symlinkSync(moved, target, "file")
    expect(evaluateResidentAegisContract({ repositoryRoot: root, request: request() }).status).toBe("INPUT_REJECTED")
  })

  it("rejects symlinked ancestors of reviewed trust artifacts", () => {
    const root = fixture()
    const configRoot = path.join(root, "config")
    const moved = path.join(root, "real-config")
    fs.renameSync(configRoot, moved)
    fs.symlinkSync(moved, configRoot, "junction")
    expect(evaluateResidentAegisContract({ repositoryRoot: root, request: request() })).toMatchObject({
      status: "INPUT_REJECTED",
      reasons: [{ code: "PATH_ESCAPE" }],
    })
  })
})
