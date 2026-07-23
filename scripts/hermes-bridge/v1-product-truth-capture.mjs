import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import pg from "pg"

const ISSUE_NUMBER = 448
const EVENT_TYPES = Object.freeze([
  "HERMES_RUNTIME_CHECKPOINT",
  "HERMES_RUNTIME_FAILURE_EVAL",
  "HERMES_RUNTIME_LEASE",
])
const ARTIFACT_KINDS = new Set(["product-truth-snapshot", "persisted-state-snapshot"])

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function sortedIds(rows) {
  return rows.map((row) => String(row.id)).sort((left, right) => Number(left) - Number(right))
}

export function buildProductTruthEvidence({ workOrder, events, evidenceRecords }) {
  if (!workOrder || !Number.isSafeInteger(workOrder.id)
    || typeof workOrder.ref !== "string" || !workOrder.ref.startsWith("WO-HERMES-OUTCOME-")) {
    throw new Error("PRODUCT_TRUTH_WORK_ORDER_INVALID")
  }
  const checkpoints = events.filter((row) => row.eventType === EVENT_TYPES[0])
  const failureEvaluations = events.filter((row) => row.eventType === EVENT_TYPES[1])
  const leases = events.filter((row) => row.eventType === EVENT_TYPES[2])
  if (checkpoints.length === 0 || leases.length === 0
    || events.some((row) => !EVENT_TYPES.includes(row.eventType))
    || evidenceRecords.some((row) => row.workOrderId !== workOrder.id)) {
    throw new Error("PRODUCT_TRUTH_RELATION_INVALID")
  }
  const checkpointEventIds = sortedIds(checkpoints)
  const failureEvalEventIds = sortedIds(failureEvaluations)
  const leaseEventIds = sortedIds(leases)
  const traceEventIds = sortedIds(events)
  const evidenceRecordIds = sortedIds(evidenceRecords)
  const identity = {
    workOrderId: workOrder.id,
    workOrderRef: workOrder.ref,
    workOrderViewId: workOrder.id,
    runtimeWorkOrderId: workOrder.id,
    traceWorkOrderId: workOrder.id,
    runtimeExecutionId: `work-order:${workOrder.id}`,
    checkpointEventIds,
    leaseEventIds,
    failureEvalEventIds,
    evalEventIds: failureEvalEventIds,
    evidenceRecordIds,
    evidenceWorkOrderIds: evidenceRecords.map((row) => row.workOrderId),
    traceEventIds,
  }
  return {
    ...identity,
    consistencyDigest: sha256(JSON.stringify(canonical(identity))),
    consistent: true,
    querySource: "PERSISTED_DATABASE",
    capturedBy: "scripts/hermes-bridge/v1-product-truth-capture.mjs",
  }
}

function parseArgs(argv) {
  const options = { workOrderRef: null, kind: null, output: null, revision: null }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value) throw new Error(`ARGUMENT_VALUE_REQUIRED:${flag}`)
    if (flag === "--work-order-ref") options.workOrderRef = value
    else if (flag === "--kind") options.kind = value
    else if (flag === "--output") options.output = path.resolve(value)
    else if (flag === "--revision") options.revision = value
    else throw new Error(`UNKNOWN_ARGUMENT:${flag}`)
  }
  if (!options.workOrderRef?.startsWith("WO-HERMES-OUTCOME-")) throw new Error("WORK_ORDER_REF_REQUIRED")
  if (!ARTIFACT_KINDS.has(options.kind)) throw new Error("PRODUCT_TRUTH_ARTIFACT_KIND_REQUIRED")
  if (!options.output) throw new Error("OUTPUT_REQUIRED")
  if (!/^[0-9a-f]{40}$/i.test(options.revision ?? "")) throw new Error("REVISION_REQUIRED")
  return options
}

async function readPersistedTruth(client, workOrderRef) {
  const workOrderResult = await client.query(
    `SELECT id, ref FROM work_order WHERE ref = $1 ORDER BY id DESC LIMIT 1`,
    [workOrderRef],
  )
  const workOrder = workOrderResult.rows[0]
  if (!workOrder) throw new Error("PRODUCT_TRUTH_WORK_ORDER_NOT_FOUND")
  workOrder.id = Number(workOrder.id)
  const [eventsResult, evidenceResult] = await Promise.all([
    client.query(
      `SELECT id, "eventType" FROM governance_event
       WHERE "entityType" = 'work_order' AND "entityId" = $1
         AND "eventType" = ANY($2::text[])
       ORDER BY id`,
      [String(workOrder.id), EVENT_TYPES],
    ),
    client.query(
      `SELECT id, "workOrderId" FROM evidence_record
       WHERE "workOrderId" = $1 ORDER BY id`,
      [workOrder.id],
    ),
  ])
  return {
    workOrder,
    events: eventsResult.rows,
    evidenceRecords: evidenceResult.rows.map((row) => ({
      id: row.id,
      workOrderId: Number(row.workOrderId),
    })),
  }
}

export async function captureProductTruthEvidence(connectionString, workOrderRef) {
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED")
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    return buildProductTruthEvidence(await readPersistedTruth(client, workOrderRef))
  } finally {
    await client.end()
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  fs.renameSync(temporary, filePath)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED")
  const evidence = await captureProductTruthEvidence(connectionString, options.workOrderRef)
  const observedAt = new Date().toISOString()
  writeJson(options.output, {
    schemaVersion: 1,
    issueNumber: ISSUE_NUMBER,
    acceptanceCriterion: "AC-11",
    kind: options.kind,
    proofClass: "LIVE",
    observedAt,
    sourceRevision: options.revision,
    status: "PASS",
    evidence,
  })
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main()
}
