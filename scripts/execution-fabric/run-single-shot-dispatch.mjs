import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  buildHermesLoopbackRequest,
  executeHermesLoopbackInference,
} from "./adapters/hermes-loopback-inference.mjs"
import {
  DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY,
  DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG,
  digestBoundedDispatchTaskTemplate,
  loadBoundedDispatchAuthorityFiles,
  proveBoundedDispatchAuthorityFromGit,
  settleBoundedDispatchAuthority,
} from "./bounded-dispatch-authority.mjs"
import { canonicalizeJcs } from "./canonical-json.mjs"
import { createSingleShotDispatchStore } from "./runtime/single-shot-dispatch-store.mjs"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_PROMPT_PATH = path.resolve(
  moduleDirectory,
  "../../config/execution-fabric/task-prompts/hermes-loopback-local-inference-v1.txt",
)

export class SingleShotDispatchRunnerError extends Error {
  constructor(code, detail = code) {
    super(`${code}: ${detail}`)
    this.name = "SingleShotDispatchRunnerError"
    this.code = code
  }
}

function fail(code, detail) {
  throw new SingleShotDispatchRunnerError(code, detail)
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(canonicalizeJcs(value), "utf8")
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

export function compileSingleShotAdmission({ catalog, registry, request, at, placement, authorityProof }) {
  const authority = settleBoundedDispatchAuthority({ catalog, registry, request, at })
  if (authority.status !== "SINGLE_USE_AUTHORITY_SETTLED" || authority.eligible_for_single_shot_dispatch !== true) {
    return Object.freeze({
      schema_version: "0.1-single-shot-dispatch-admission",
      status: "BLOCKED",
      reason: authority.reason ?? authority.status,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
      execution_performed: false,
    })
  }
  if (!authorityProof || authorityProof.status !== "TRUSTED_MAIN_AUTHORITY_PROVEN"
    || authorityProof.scope_sha256 !== authority.scope_sha256
    || authorityProof.scope_commit !== authority.reviewed_scope_commit
    || authorityProof.activation_commit !== authority.activation_commit
    || authorityProof.scheduler_state !== "OFF" || authorityProof.execution_performed !== false) {
    fail("AUTHORITY_PROVENANCE_INVALID")
  }
  if (!placement || !["PLACEMENT_RECOMMENDED", "RECOMMENDED"].includes(placement.status)
    || placement.recommendation_only !== true
    || placement.scheduler?.state !== "disabled"
    || placement.scheduler?.authority !== "not-granted"
    || placement.scheduler?.autonomous_dispatch !== "forbidden"
    || placement.recommendation?.node_id !== "hermes-node"
    || placement.recommendation?.rank !== 1
    || placement.recommendation?.execution_authorized !== false
    || placement.recommendation?.dispatch_allowed !== false) fail("PLACEMENT_RECEIPT_INVALID")
  const selected = placement.eligible_nodes?.find((entry) => entry.node_id === "hermes-node")
  if (!selected || selected.eligible !== true || selected.rank !== 1
    || selected.freshness?.state !== "fresh" || Date.parse(at) >= Date.parse(selected.freshness.expires_at)
    || !["observed", "proven"].includes(selected.confidence)) fail("PLACEMENT_RECEIPT_STALE_OR_UNTRUSTED")
  if (placement.workload?.id !== "gpu-local-inference" && placement.workload?.id !== "local-llm-inference") {
    fail("PLACEMENT_WORKLOAD_MISMATCH")
  }
  const unsigned = {
    schema_version: "0.1-single-shot-dispatch-admission",
    status: "ADMITTED",
    dispatch_id: `DISPATCH-${authority.work_order_id}`,
    work_order_id: authority.work_order_id,
    authority_reference: authority.authority_reference,
    scope_id: authority.scope_id,
    scope_sha256: authority.scope_sha256,
    authority_nonce: authority.nonce,
    authority_expires_at: authority.expires_at,
    authority_proof_sha256: sha256(authorityProof),
    template_id: authority.template_id,
    template_version: authority.template_version,
    template_sha256: authority.template_sha256,
    selected_node_id: authority.selected_node,
    placement_sha256: sha256(placement),
    placement_expires_at: selected.freshness.expires_at,
    maximum_calls: 1,
    timeout_seconds: 60,
    scheduler_state: "OFF",
    autonomous_dispatch: false,
    silent_replacement_allowed: false,
  }
  return Object.freeze({ ...unsigned, admission_sha256: sha256(unsigned) })
}

export async function runSingleShotDispatch({
  admission,
  template,
  promptBytes,
  store,
  trustedIdentity = "resident-hermes@hermes-node",
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  holderId = "resident-hermes",
  holderTokenDigest,
}) {
  const unsignedAdmission = admission && typeof admission === "object"
    ? Object.fromEntries(Object.entries(admission).filter(([key]) => key !== "admission_sha256"))
    : null
  if (!admission || admission.status !== "ADMITTED" || admission.admission_sha256 !== sha256(unsignedAdmission)
    || admission.scheduler_state !== "OFF"
    || admission.autonomous_dispatch !== false || admission.maximum_calls !== 1
    || admission.selected_node_id !== "hermes-node" || admission.template_id !== template.id
    || admission.template_sha256 !== digestBoundedDispatchTaskTemplate(template)) fail("ADMISSION_INVALID")
  if (!store || typeof store.admit !== "function") fail("DISPATCH_STORE_REQUIRED")
  if (typeof holderTokenDigest !== "string" || !/^[a-f0-9]{64}$/.test(holderTokenDigest)) {
    fail("HOLDER_TOKEN_DIGEST_REQUIRED")
  }
  const admitted = store.admit(admission)
  if (["COMPLETE", "FAILED_TERMINAL", "OUTCOME_UNKNOWN_DO_NOT_REPLAY"].includes(admitted.state)) {
    return admitted
  }
  const at = new Date(clock()).toISOString()
  if (Date.parse(at) >= Date.parse(admission.authority_expires_at)
    || Date.parse(at) >= Date.parse(admission.placement_expires_at)) fail("ADMISSION_EXPIRED")
  const leased = store.acquire({
    dispatchId: admission.dispatch_id,
    holderId,
    holderTokenDigest,
    leaseDurationMs: Math.min(admission.timeout_seconds * 1000 + 10_000, 120_000),
  })
  if (leased.state === "COMPLETE" || leased.state === "OUTCOME_UNKNOWN_DO_NOT_REPLAY"
    || leased.state === "FAILED_TERMINAL") return leased
  const request = buildHermesLoopbackRequest({ template, promptBytes, trustedIdentity })
  store.markRequestStarted({
    dispatchId: admission.dispatch_id,
    holderId,
    fencingToken: leased.fencing_token,
    requestSha256: request.request_sha256,
  })
  try {
    const result = await executeHermesLoopbackInference({
      template,
      promptBytes,
      trustedIdentity,
      fetchImpl,
      clock,
    })
    if (result.request_sha256 !== request.request_sha256 || result.calls_performed !== 1) {
      fail("ADAPTER_RESULT_BINDING_MISMATCH")
    }
    const receipt = {
      schema_version: "0.1-single-shot-dispatch-receipt",
      dispatch_id: admission.dispatch_id,
      work_order_id: admission.work_order_id,
      authority_reference: admission.authority_reference,
      admission_sha256: admission.admission_sha256,
      template_id: admission.template_id,
      template_sha256: admission.template_sha256,
      selected_node_id: admission.selected_node_id,
      placement_sha256: admission.placement_sha256,
      request_sha256: result.request_sha256,
      response_sha256: result.response_sha256,
      started_at: result.started_at,
      completed_at: result.completed_at,
      marker: result.marker,
      calls_performed: result.calls_performed,
      fencing_token: leased.fencing_token,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
      silent_replacement_performed: false,
      result: "PASS",
    }
    return store.complete({
      dispatchId: admission.dispatch_id,
      holderId,
      fencingToken: leased.fencing_token,
      responseSha256: result.response_sha256,
      receipt,
    })
  } catch (error) {
    try {
      store.failTerminal({
        dispatchId: admission.dispatch_id,
        holderId,
        fencingToken: leased.fencing_token,
        reason: "BOUNDED_ADAPTER_FAILED",
      })
    } catch {}
    throw error
  }
}

function parseArgs(argv) {
  const allowed = new Set(["--admission"])
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(key) || typeof value !== "string") fail("CLI_ARGUMENT_INVALID")
    if (Object.hasOwn(values, key)) fail("CLI_ARGUMENT_INVALID")
    values[key] = value
  }
  if (Object.keys(values).length !== 1) fail("CLI_ARGUMENT_INVALID")
  return values
}

export async function runCli(argv, options = {}) {
  const args = parseArgs(argv)
  const repositoryRoot = path.resolve(moduleDirectory, "../..")
  const admissionPath = path.resolve(args["--admission"])
  const relativeAdmissionPath = path.relative(repositoryRoot, admissionPath).replaceAll("\\", "/")
  if (!relativeAdmissionPath.startsWith("docs/reports/bounded-dispatch-admissions/")
    || relativeAdmissionPath.includes("../")) fail("ADMISSION_PATH_UNTRUSTED")
  const admissionBytes = fs.readFileSync(admissionPath)
  const trustedAdmission = spawnSync("git", ["show", `origin/main:${relativeAdmissionPath}`], {
    cwd: repositoryRoot,
    encoding: null,
    windowsHide: true,
  })
  if (trustedAdmission.error || trustedAdmission.status !== 0
    || !Buffer.from(trustedAdmission.stdout).equals(admissionBytes)) fail("ADMISSION_NOT_REVIEWED_ON_MAIN")
  const admission = JSON.parse(admissionBytes.toString("utf8"))
  const { catalog, registry } = loadBoundedDispatchAuthorityFiles({
    catalogPath: DEFAULT_BOUNDED_DISPATCH_TEMPLATE_CATALOG,
    registryPath: DEFAULT_BOUNDED_DISPATCH_AUTHORITY_REGISTRY,
  })
  const template = catalog.templates[0]
  const settlement = settleBoundedDispatchAuthority({
    catalog,
    registry,
    request: {
      authority_reference: admission.authority_reference,
      work_order_id: admission.work_order_id,
      scope_id: admission.scope_id,
      scope_sha256: admission.scope_sha256,
      template_id: admission.template_id,
      template_version: admission.template_version,
      template_sha256: admission.template_sha256,
      selected_node: admission.selected_node_id,
      nonce: admission.authority_nonce,
    },
    at: new Date(options.clock?.() ?? Date.now()).toISOString(),
  })
  if (settlement.status !== "SINGLE_USE_AUTHORITY_SETTLED") fail("AUTHORITY_NOT_ACTIVE")
  const authorityProof = proveBoundedDispatchAuthorityFromGit({
    repositoryRoot,
    settlement,
    trustedRef: "refs/remotes/origin/main",
  })
  if (admission.authority_proof_sha256 !== sha256(authorityProof)) fail("ADMISSION_AUTHORITY_PROOF_MISMATCH")
  const promptBytes = fs.readFileSync(DEFAULT_PROMPT_PATH)
  const holderTokenDigest = crypto.randomBytes(32).toString("hex")
  const store = createSingleShotDispatchStore(path.join(
    os.homedir(),
    ".williamos",
    "execution-fabric",
    "single-shot-dispatch-state.json",
  ), { clock: options.clock })
  return runSingleShotDispatch({
    admission,
    template,
    promptBytes,
    store,
    holderTokenDigest,
    fetchImpl: options.fetchImpl,
    clock: options.clock,
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => {
      process.stderr.write(`${error?.code ?? "BOUNDED_DISPATCH_FAILED"}\n`)
      process.exitCode = 1
    },
  )
}
