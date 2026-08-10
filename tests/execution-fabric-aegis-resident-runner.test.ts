import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { canonicalizeJcs } from "../scripts/execution-fabric/canonical-json.mjs"
import {
  createLedgerProviders,
  createTrustedProofProviders,
  parseArguments,
  readConfinedReport,
  trustedResidentIdentity,
} from "../scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs"

const sha = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex")

function privateHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-resident-home-"))
  fs.chmodSync(home, 0o700)
  return home
}

describe("resident AEGIS HASH_VERIFY runner", () => {
  it("accepts only the exact request and receipt argument pair", () => {
    expect(parseArguments(["--request", "docs/reports/request.json", "--receipt", "docs/reports/receipt.json"])).toEqual({
      request: "docs/reports/request.json",
      receipt: "docs/reports/receipt.json",
    })
    expect(() => parseArguments(["--request", "x", "--request", "y", "--receipt", "z"])).toThrow("ARGUMENT_INVALID")
    expect(() => parseArguments(["--request", "x", "--receipt", "y", "--command", "id"])).toThrow("ARGUMENT_INVALID")
    expect(() => parseArguments(["--request", "x"])).toThrow("ARGUMENT_INVALID")
  })

  it("confines both artifacts beneath a real repository docs/reports root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-resident-repo-"))
    const reports = path.join(root, "docs", "reports")
    fs.mkdirSync(reports, { recursive: true })
    fs.writeFileSync(path.join(reports, "request.json"), "{}")
    expect(readConfinedReport("docs/reports/request.json", root).toString()).toBe("{}")
    expect(() => readConfinedReport("package.json", root)).toThrow("PATH_ESCAPE")
    expect(() => readConfinedReport("docs/reports/../secret.json", root)).toThrow("PATH_ESCAPE")
    expect(() => readConfinedReport(path.join(root, "docs/reports/request.json"), root)).toThrow("PATH_ESCAPE")
    if (process.platform !== "win32") {
      fs.writeFileSync(path.join(root, "outside.json"), "{}")
      fs.symlinkSync(path.join(root, "outside.json"), path.join(reports, "linked.json"))
      expect(() => readConfinedReport("docs/reports/linked.json", root)).toThrow("PATH_ESCAPE")
    }
  })

  it("requires Linux, a non-root user, hostname aegis, and the hashed machine id", () => {
    const expected = sha("0123456789abcdef0123456789abcdef")
    expect(trustedResidentIdentity({
      platform: "linux", getuid: () => 1000, username: () => "williamos-fabric", hostname: () => "aegis",
      readMachineId: () => Buffer.from("0123456789abcdef0123456789abcdef\n"),
    })).toEqual({
      node_id: "aegis", hostname: "aegis", machine_id_sha256: expected,
      agent_identity: "resident-aegis", provider_identity: "resident-aegis",
    })
    expect(() => trustedResidentIdentity({ platform: "win32", getuid: () => 1000 })).toThrow("PLATFORM_MISMATCH")
    expect(() => trustedResidentIdentity({ platform: "linux", getuid: () => 0 })).toThrow("ROOT_FORBIDDEN")
    expect(() => trustedResidentIdentity({
      platform: "linux", getuid: () => 1000, username: () => "williamos-fabric",
      hostname: () => "other", readMachineId: () => Buffer.from("0".repeat(32)),
    })).toThrow("IDENTITY_MISMATCH")
    expect(() => trustedResidentIdentity({
      platform: "linux", getuid: () => 1000, username: () => "other",
    })).toThrow("EXECUTION_IDENTITY_MISMATCH")
  })

  it("atomically consumes one claim and keeps duplicate attempts consumed", async () => {
    const providers = createLedgerProviders({
      ledgerRoot: privateHome(), platform: "linux", getuid: () => process.getuid?.() ?? 1000,
      username: () => "williamos-fabric",
      clock: () => "2026-08-10T08:01:00.000Z",
      holderIdentity: () => ({ pid: 100, boot_id: "boot", process_start_ticks: "10" }),
      holderIsAlive: () => true,
      validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
      validateLedgerFile: (stats: fs.Stats) => stats.isFile() && !stats.isSymbolicLink(),
      syncDirectory: () => undefined,
    })
    const input = { request_sha256: "1".repeat(64), scope_sha256: "2".repeat(64), authority_reference: "authority-001", maximum_attempts: 1 }
    const results = await Promise.all([providers.claimSingleUse(input), providers.claimSingleUse(input)])
    expect(results.filter((entry) => entry.claimed)).toHaveLength(1)
    expect(results.filter((entry) => !entry.claimed)).toHaveLength(1)
    expect(fs.readdirSync(providers.ledgerRoot).filter((name) => name.startsWith("claim-"))).toHaveLength(1)
    expect(providers.runtimeEvidence().claim_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(results[0].claim_id).toBe(results[1].claim_id)
  })

  it("rejects an occupied lease and releases only the matching lease", async () => {
    let tick = 0
    const providers = createLedgerProviders({
      ledgerRoot: privateHome(), platform: "linux", getuid: () => process.getuid?.() ?? 1000,
      username: () => "williamos-fabric",
      clock: () => `2026-08-10T08:01:0${tick++}.000Z`,
      holderIdentity: () => ({ pid: 100, boot_id: "boot", process_start_ticks: "10" }),
      holderIsAlive: () => true,
      validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
      validateLedgerFile: (stats: fs.Stats) => stats.isFile() && !stats.isSymbolicLink(),
      syncDirectory: () => undefined,
    })
    const first = await providers.acquireExclusiveLease({ claim_id: "claim-one" })
    const occupied = await providers.acquireExclusiveLease({ claim_id: "claim-two" })
    expect(first.acquired).toBe(true)
    expect(occupied.acquired).toBe(false)
    expect(await providers.releaseExclusiveLease({ lease_id: first.lease_id, claim_id: "wrong" })).toBe(false)
    expect(await providers.releaseExclusiveLease({ lease_id: first.lease_id, claim_id: "claim-one" })).toBe(true)
    expect(providers.runtimeEvidence()).toMatchObject({
      lease_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      release_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(fs.readdirSync(providers.ledgerRoot).filter((name) => name.startsWith("release-"))).toHaveLength(1)
    expect((await providers.acquireExclusiveLease({ claim_id: "claim-two" })).acquired).toBe(true)
  })

  it("recovers a lease only after the exact process holder is proven dead", async () => {
    const ledgerRoot = privateHome()
    const common = {
      ledgerRoot, platform: "linux", getuid: () => process.getuid?.() ?? 1000,
      username: () => "williamos-fabric",
      validateDirectory: (stats: fs.Stats) => stats.isDirectory() && !stats.isSymbolicLink(),
      validateLedgerFile: (stats: fs.Stats) => stats.isFile() && !stats.isSymbolicLink(),
      syncDirectory: () => undefined,
    }
    const first = createLedgerProviders({
      ...common, clock: () => "2026-08-10T08:01:00.000Z",
      holderIdentity: () => ({ pid: 100, boot_id: "boot-one", process_start_ticks: "10" }),
      holderIsAlive: () => true,
    })
    expect((await first.acquireExclusiveLease({ claim_id: "claim-one" })).acquired).toBe(true)

    const second = createLedgerProviders({
      ...common, clock: () => "2026-08-10T08:02:00.000Z",
      holderIdentity: () => ({ pid: 200, boot_id: "boot-one", process_start_ticks: "20" }),
      holderIsAlive: () => false,
    })
    expect((await second.acquireExclusiveLease({ claim_id: "claim-two" })).acquired).toBe(true)
    expect(second.runtimeEvidence().recovery_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(fs.readdirSync(ledgerRoot).filter((name) => name.startsWith("recovery-"))).toHaveLength(1)
  })

  it("uses exact trusted-main Git command arrays and emits exact proof shapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-proof-repo-"))
    const files: Record<string, Buffer> = {
      "scripts/execution-fabric/verify_snapshot.py": Buffer.from("verifier"),
      "config/execution-fabric/registry.seed.json": Buffer.from("{}"),
      "config/execution-fabric/registry.schema.json": Buffer.from("{}"),
      "config/execution-fabric/pinned-evidence-policy.json": Buffer.from("{}"),
      "config/execution-fabric/placement-workloads.json": Buffer.from("{}"),
      "config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json": Buffer.from("permission"),
      "config/execution-fabric/aegis-bounded-dispatch-templates.json": Buffer.from(JSON.stringify({ templates: [{ template_id: "aegis.hash-verify.v1" }] })),
      "config/execution-fabric/aegis-resident-identity.json": Buffer.from("identity"),
      "config/execution-fabric/aegis-bounded-dispatch-work-order.json": Buffer.from("work-order"),
      "config/execution-fabric/aegis-bounded-dispatch-authority-registry.json": Buffer.from(JSON.stringify({ entries: [{ reference: "authority-001" }] })),
      "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json": Buffer.from("scope"),
    }
    for (const [relative, bytes] of Object.entries(files)) {
      const destination = path.join(root, ...relative.split("/"))
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, bytes)
    }
    const calls: string[][] = []
    const headCommit = "c".repeat(40)
    const treeCommit = "d".repeat(40)
    const runGit = (args: string[]) => {
      calls.push(args)
      if (args[0] === "merge-base") return Buffer.alloc(0)
      if (args[0] === "status") return Buffer.alloc(0)
      if (args[0] === "rev-parse") return Buffer.from(`${args[1] === "HEAD^{tree}" ? treeCommit : headCommit}\n`)
      const spec = args[1]
      const separator = spec.indexOf(":")
      return files[spec.slice(separator + 1)]
    }
    const receipt = {
      workload: { id: "cpu-heavy-build" }, evaluated_at: "2026-08-10T08:00:00.000Z",
      evidence_snapshot: [{ node: "aegis", snapshot_sha256: "1".repeat(64) }],
    }
    const providers = createTrustedProofProviders({
      repositoryRoot: root, snapshotRoot: "/var/lib/williamos/fabric/snapshots", runGit,
      runPlacementReplay: () => receipt,
    })
    expect(providers.proveTrustedCheckout()).toEqual({
      schema_version: "0.1-trusted-aegis-executable-checkout", trusted_ref: "refs/heads/main",
      head_commit: headCommit, tree_sha1: treeCommit, clean: true, verified: true,
    })
    const dirty = createTrustedProofProviders({
      repositoryRoot: root,
      runGit: (args: string[]) => args[0] === "status" ? Buffer.from(" M changed.mjs\n") : runGit(args),
    })
    expect(() => dirty.proveTrustedCheckout()).toThrow("TRUSTED_MAIN_MISMATCH")
    expect(providers.proveTrustedPlacement({ receiptSha256: "2".repeat(64), receipt })).toEqual({
      schema_version: "0.1-trusted-pinned-placement-proof",
      receipt_sha256: "2".repeat(64),
      semantic_replay_sha256: sha(Buffer.from(canonicalizeJcs(receipt))),
      evidence_count: 1,
      verified: true,
    })
    expect(providers.proveTrustedForge({
      permissionSha256: sha(files["config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json"]),
      templateRegistrySha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-templates.json"]),
      identityRegistrySha256: sha(files["config/execution-fabric/aegis-resident-identity.json"]),
      workOrderSha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-work-order.json"]),
    })).toEqual({
      schema_version: "0.1-trusted-aegis-forge-proof", trusted_ref: "refs/heads/main",
      permission_sha256: sha(files["config/execution-fabric/agent-forge-aegis-bounded-hash-verify-permission.json"]),
      template_registry_sha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-templates.json"]),
      identity_registry_sha256: sha(files["config/execution-fabric/aegis-resident-identity.json"]),
      work_order_sha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-work-order.json"]),
      exact_template_count: 1, verified: true,
    })
    const executionCommit = "a".repeat(40)
    const reviewedCommit = "b".repeat(40)
    expect(providers.proveTrustedAuthority({
      registrySha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"]),
      authority: {
        reference: "authority-001", producer_identity: "resident-aegis", reviewer_identity: "independent-assurance",
        execution_commit: executionCommit, reviewed_commit: reviewedCommit,
        scope_path: "config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json",
      },
      scopeSha256: "3".repeat(64),
      scopeArtifactSha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json"]),
    })).toEqual({
      schema_version: "0.1-trusted-aegis-authority-proof", trusted_ref: "refs/heads/main",
      registry_sha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-authority-registry.json"]),
      authority_reference: "authority-001", producer_identity: "resident-aegis", reviewer_identity: "independent-assurance",
      execution_commit: executionCommit, authority_reviewed_commit: reviewedCommit,
      strict_after_commit: executionCommit, review_commit_is_strict_descendant: true,
      scope_sha256: "3".repeat(64),
      scope_artifact_sha256: sha(files["config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json"]), exact_entry_count: 1,
    })
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", executionCommit, reviewedCommit])
    expect(calls).toContainEqual(["merge-base", "--is-ancestor", reviewedCommit, "refs/heads/main"])
    expect(calls).toContainEqual(["show", `${executionCommit}:config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json`])
    expect(calls).toContainEqual(["show", `${reviewedCommit}:config/execution-fabric/aegis-bounded-dispatch-authority-scopes/scope.json`])
    expect(calls.every((args) => args[0] === "show" || args[0] === "rev-parse" || args[0] === "status"
      || JSON.stringify(args) === JSON.stringify(["merge-base", "--is-ancestor", executionCommit, reviewedCommit])
      || JSON.stringify(args) === JSON.stringify(["merge-base", "--is-ancestor", reviewedCommit, "refs/heads/main"]))).toBe(true)
  })

  it("contains no network, remote-provider, arbitrary-command, or scheduler API surface", () => {
    const source = fs.readFileSync(path.join(
      process.cwd(), "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-hash-verify.mjs",
    ), "utf8")
    expect(source).toContain('import { executeAegisHashVerify } from "./aegis-hash-verify.mjs"')
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|XMLHttpRequest|createConnection|connect)\s*\(/)
    expect(source).not.toMatch(/node:(?:http|https|net|tls|dns)|\bssh\b|api\.github\.com|\bgh\b/)
    expect(source).not.toMatch(/\b(?:exec|execFile|fork)Sync?\s*\(|shell:\s*true/)
    expect(source).not.toMatch(/--command|workloadCommand|fallbackProvider|scheduler\.(?:start|run)/)
    expect(source.match(/spawnSync\(/g)).toHaveLength(1)
    expect(source).toContain('const GIT_BINARY = "/usr/bin/git"')
  })
})
