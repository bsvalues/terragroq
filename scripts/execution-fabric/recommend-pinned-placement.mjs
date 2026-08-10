import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { evaluatePlacement } from "./recommend-placement.mjs"
import { applyPinnedEvidence, loadPinnedEvidence } from "./pinned-evidence-registry.mjs"

const EXIT_INVALID = 2

function fail(message) {
  throw new Error(`FABRIC_PINNED_PLACEMENT_INVALID: ${message}`)
}

function rejected(error) {
  return {
    schema_version: "0.2-pinned-placement-recommendation",
    status: "INPUT_REJECTED",
    recommendation_only: true,
    recommendation: null,
    eligible_nodes: [],
    ineligible_nodes: [],
    evidence_snapshot: [],
    error: { code: "FABRIC_PINNED_PLACEMENT_INVALID", detail: String(error?.message ?? error) },
    authority_mutated: false,
    remote_systems_modified: false,
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"))
  } catch (error) {
    fail(`unable to read ${label}: ${error.message}`)
  }
}

function fileSha256(filePath, label) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(path.resolve(filePath))).digest("hex")
  } catch (error) {
    fail(`unable to hash ${label}: ${error.message}`)
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function validatePinnedCatalog(catalog) {
  if (catalog?.schema_version !== "0.1-placement-workloads"
    || catalog?.recommendation_only !== true
    || !Array.isArray(catalog?.workloads)) {
    fail("workload catalog contract is invalid")
  }
  const ids = catalog.workloads.map((workload) => workload?.id)
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
    fail("workload catalog contains invalid or duplicate IDs")
  }
}

function parseReference(value) {
  const separator = value.indexOf("=")
  if (separator <= 0) fail("--evidence must use node=sha256")
  return { node: value.slice(0, separator), snapshot_sha256: value.slice(separator + 1) }
}

function parseArguments(argv) {
  const parsed = { evidence: [] }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || value === undefined) fail("arguments must use --name value pairs")
    const name = key.slice(2)
    if (name === "evidence") parsed.evidence.push(parseReference(value))
    else if (Object.hasOwn(parsed, name)) fail(`duplicate --${name}`)
    else parsed[name] = value
  }
  for (const required of ["snapshot-root", "verifier", "registry", "schema", "policy", "workloads", "workload", "at"]) {
    if (!parsed[required]) fail(`--${required} is required`)
  }
  return parsed
}

function runOrThrow(argv) {
  const args = parseArguments(argv)
  const registryBase = readJson(args.registry, "registry base")
  const schema = readJson(args.schema, "registry schema")
  const policy = readJson(args.policy, "pinned evidence policy")
  const catalog = readJson(args.workloads, "workload catalog")
  validatePinnedCatalog(catalog)
  const workload = catalog.workloads.find((candidate) => candidate.id === args.workload)
  if (!workload) fail(`workload not found: ${args.workload}`)
  const evidence = loadPinnedEvidence({
    snapshotRoot: args["snapshot-root"],
    references: args.evidence,
    policy,
    verifier: args.verifier,
    python: args.python ?? "python3",
  })
  const registry = applyPinnedEvidence(registryBase, evidence.loaded)
  const placement = evaluatePlacement(registry, workload, { evaluatedAt: args.at, schema })
  if (placement.status === "INPUT_REJECTED") fail(placement.error.detail)
  const inputArtifacts = {
    registry_base_sha256: fileSha256(args.registry, "registry base"),
    registry_schema_sha256: fileSha256(args.schema, "registry schema"),
    pinned_evidence_policy_sha256: fileSha256(args.policy, "pinned evidence policy"),
    workload_catalog_sha256: fileSha256(args.workloads, "workload catalog"),
  }
  const receipt = {
    ...placement,
    schema_version: "0.2-pinned-placement-recommendation",
    placement_policy_version: "execution-fabric-placement/0.2",
    evidence_snapshot: evidence.loaded.map(({ reference }) => reference),
    evidence_verifier: {
      contract: policy.canonicalization_contract,
      reference_implementation: path.basename(args.verifier),
      sha256: evidence.verifier_sha256,
      result: "PASS",
    },
    input_artifacts: inputArtifacts,
    catalog_schema_version: catalog.schema_version,
  }
  receipt.decision_input_sha256 = crypto.createHash("sha256").update(canonicalJson({
    workload,
    evidence_snapshot: receipt.evidence_snapshot,
    placement_policy_version: receipt.placement_policy_version,
    evaluated_at: receipt.evaluated_at,
    input_artifacts: inputArtifacts,
    verifier_contract: policy.canonicalization_contract,
  })).digest("hex")
  return receipt
}

export function runPinnedPlacementCli(argv) {
  try {
    return runOrThrow(argv)
  } catch (error) {
    if (/^(FABRIC_PINNED_(?:PLACEMENT|EVIDENCE)_INVALID|FABRIC_PLACEMENT_INVALID):/.test(String(error?.message ?? error))) {
      return rejected(error)
    }
    throw error
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const result = runPinnedPlacementCli(process.argv.slice(2))
  const stream = result.status === "INPUT_REJECTED" ? process.stderr : process.stdout
  stream.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === "INPUT_REJECTED") process.exitCode = EXIT_INVALID
}
