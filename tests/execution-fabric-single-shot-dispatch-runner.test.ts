import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  digestBoundedDispatchTaskTemplate,
  validateBoundedDispatchTaskTemplateCatalog,
} from "../scripts/execution-fabric/bounded-dispatch-authority.mjs"
import {
  compileSingleShotAdmission,
  runCli,
  runSingleShotDispatch,
} from "../scripts/execution-fabric/run-single-shot-dispatch.mjs"
import { createSingleShotDispatchStore } from "../scripts/execution-fabric/runtime/single-shot-dispatch-store.mjs"

const dirs: string[] = []
const promptBytes = fs.readFileSync(path.join(process.cwd(), "config/execution-fabric/task-prompts/hermes-loopback-local-inference-v1.txt"))
const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config/execution-fabric/bounded-dispatch-task-templates.json"), "utf8"))
const template = validateBoundedDispatchTaskTemplateCatalog(catalog).templates[0]
const templateSha256 = digestBoundedDispatchTaskTemplate(template)
const at = "2026-08-10T18:30:00.000Z"

function authorityRegistry() {
  return {
    schema_version: "0.1-bounded-dispatch-authority-registry",
    registry_id: "execution-fabric-bounded-dispatch-authorities",
    entries: [{
      authority_reference: "phase3-hermes-bounded-dispatch-001",
      work_order_id: "WO-EF-PHASE3-001",
      scope_id: "issue-538-phase3-dispatch-001",
      scope_path: "config/execution-fabric/dispatch-authority-scopes/WO-EF-PHASE3-001.json",
      scope_sha256: "c".repeat(64),
      template_id: template.id,
      template_version: template.version,
      template_sha256: templateSha256,
      selected_node: "hermes-node",
      valid_from: "2026-08-10T18:00:00.000Z",
      expires_at: "2026-08-10T19:00:00.000Z",
      reviewed_scope_commit: "a".repeat(40),
      activation_commit: "b".repeat(40),
      activation_evidence_path: "docs/reports/execution-fabric-dispatch-activations/WO-EF-PHASE3-001.json",
      activation_evidence_sha256: "d".repeat(64),
      nonce: "phase3-single-use-0001",
      maximum_uses: 1,
      uses_consumed: 0,
      status: "ACTIVE",
    }],
  }
}

function request() {
  return {
    authority_reference: "phase3-hermes-bounded-dispatch-001",
    work_order_id: "WO-EF-PHASE3-001",
    scope_id: "issue-538-phase3-dispatch-001",
    scope_sha256: "c".repeat(64),
    template_id: template.id,
    template_version: template.version,
    template_sha256: templateSha256,
    selected_node: "hermes-node",
    nonce: "phase3-single-use-0001",
  }
}

function placement() {
  return {
    status: "PLACEMENT_RECOMMENDED",
    recommendation_only: true,
    workload: { id: "gpu-local-inference" },
    scheduler: { state: "disabled", authority: "not-granted", autonomous_dispatch: "forbidden" },
    recommendation: { node_id: "hermes-node", rank: 1, execution_authorized: false, dispatch_allowed: false },
    eligible_nodes: [{
      node_id: "hermes-node",
      eligible: true,
      rank: 1,
      freshness: { state: "fresh", expires_at: "2026-08-10T18:45:00.000Z" },
      confidence: "observed",
    }],
  }
}

function authorityProof() {
  return {
    status: "TRUSTED_MAIN_AUTHORITY_PROVEN",
    trusted_ref: "refs/remotes/origin/main",
    scope_commit: "a".repeat(40),
    scope_path: "config/execution-fabric/dispatch-authority-scopes/WO-EF-PHASE3-001.json",
    scope_sha256: "c".repeat(64),
    activation_commit: "b".repeat(40),
    activation_evidence_path: "docs/reports/execution-fabric-dispatch-activations/WO-EF-PHASE3-001.json",
    activation_evidence_sha256: "d".repeat(64),
    scheduler_state: "OFF",
    execution_performed: false,
  }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-runner-"))
  dirs.push(directory)
  const store = createSingleShotDispatchStore(path.join(directory, "state.json"), { clock: () => Date.parse(at) })
  const admission = compileSingleShotAdmission({
    catalog,
    registry: authorityRegistry(),
    request: request(),
    at,
    placement: placement(),
    authorityProof: authorityProof(),
  })
  return { store, admission }
}

afterEach(() => dirs.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })))

describe("Execution Fabric single-shot bounded dispatch runner", () => {
  it("compiles one exact HERMES admission while the global scheduler remains off", () => {
    expect(fixture().admission).toMatchObject({
      status: "ADMITTED",
      selected_node_id: "hermes-node",
      maximum_calls: 1,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
      silent_replacement_allowed: false,
    })
    expect(compileSingleShotAdmission({
      catalog,
      registry: { ...authorityRegistry(), entries: [] },
      request: request(),
      at,
      placement: placement(),
      authorityProof: authorityProof(),
    })).toMatchObject({ status: "BLOCKED", execution_performed: false })
  })

  it("performs exactly one admitted request and returns the same completion on replay", async () => {
    const { store, admission } = fixture()
    const response = Buffer.from(JSON.stringify({ model: "llama3.2:3b", response: "HERMES_DISPATCH_001_OK", done: true }))
    const fetchImpl = vi.fn(async () => ({ status: 200, redirected: false, arrayBuffer: async () => response }))
    const input = {
      admission,
      template,
      promptBytes,
      store,
      fetchImpl,
      clock: () => Date.parse(at),
      holderTokenDigest: crypto.createHash("sha256").update("holder").digest("hex"),
    }
    const first = await runSingleShotDispatch(input)
    const second = await runSingleShotDispatch(input)
    const afterExpiry = await runSingleShotDispatch({
      ...input,
      clock: () => Date.parse("2026-08-11T18:30:00.000Z"),
    })
    expect(first).toMatchObject({ state: "COMPLETE", receipt: { result: "PASS", calls_performed: 1 } })
    expect(second).toMatchObject({ state: "COMPLETE", response_sha256: first.response_sha256 })
    expect(afterExpiry).toMatchObject({ state: "COMPLETE", response_sha256: first.response_sha256 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not allow a caller-selected state store", async () => {
    await expect(runCli(["--admission", "x", "--state", "y"]))
      .rejects.toMatchObject({ code: "CLI_ARGUMENT_INVALID" })
  })

  it("allows only one request when two holders race", async () => {
    const { store, admission } = fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const response = Buffer.from(JSON.stringify({ model: "llama3.2:3b", response: "HERMES_DISPATCH_001_OK", done: true }))
    const fetchImpl = vi.fn(async () => {
      await gate
      return { status: 200, redirected: false, arrayBuffer: async () => response }
    })
    const first = runSingleShotDispatch({
      admission, template, promptBytes, store, fetchImpl, clock: () => Date.parse(at),
      holderId: "holder-one", holderTokenDigest: "1".repeat(64),
    })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    await expect(runSingleShotDispatch({
      admission, template, promptBytes, store, fetchImpl, clock: () => Date.parse(at),
      holderId: "holder-two", holderTokenDigest: "2".repeat(64),
    })).rejects.toMatchObject({ code: "DISPATCH_ALREADY_LEASED" })
    release()
    await expect(first).resolves.toMatchObject({ state: "COMPLETE" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("fails closed for stale placement, wrong node, and post-start transport uncertainty", async () => {
    expect(() => compileSingleShotAdmission({
      catalog,
      registry: authorityRegistry(),
      request: request(),
      at,
      placement: {
        ...placement(),
        eligible_nodes: [{ ...placement().eligible_nodes[0], freshness: { state: "stale", expires_at: at } }],
      },
      authorityProof: authorityProof(),
    })).toThrowError(expect.objectContaining({ code: "PLACEMENT_RECEIPT_STALE_OR_UNTRUSTED" }))

    const { store, admission } = fixture()
    await expect(runSingleShotDispatch({
      admission,
      template,
      promptBytes,
      store,
      fetchImpl: async () => { throw new Error("network") },
      clock: () => Date.parse(at),
      holderTokenDigest: "3".repeat(64),
    })).rejects.toMatchObject({ code: "HERMES_TRANSPORT_FAILURE" })
    expect(store.read().dispatches[admission.dispatch_id]).toMatchObject({
      state: "OUTCOME_UNKNOWN_DO_NOT_REPLAY",
      request_started: true,
    })
  })
})
