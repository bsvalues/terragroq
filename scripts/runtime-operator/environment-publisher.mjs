import crypto from "node:crypto"

const WORLD_MARKER = /\[environment-world:([^\]\s]+)\]/

const RETRYABLE_RUNTIME_RESPONSES = new Set([
  "WORLD_CONCURRENTLY_CHANGED",
  "ENDPOINT_NOT_LIVE",
  "ENDPOINT_NOT_READY",
  "ENDPOINT_PUBLIC_NOT_LIVE",
  "ENDPOINT_PUBLIC_NOT_READY",
])

export function environmentRuntimeResponseIsRetryable(status, code) {
  return status === 429 || status >= 500 || RETRYABLE_RUNTIME_RESPONSES.has(String(code ?? ""))
}

export function environmentWorldId(description) {
  return WORLD_MARKER.exec(String(description ?? ""))?.[1] ?? null
}

export function environmentRuntimePayloadDigest(request) {
  const signed = request.action === "admit_endpoint"
    ? { action: request.action, worldId: request.worldId, endpoint: request.endpoint }
    : { action: request.action, worldId: request.worldId, observation: request.observation }
  return crypto.createHash("sha256").update(canonical(signed), "utf8").digest("hex")
}

export function environmentPort(worldId, range) {
  const match = /^(\d{2,5})-(\d{2,5})$/.exec(String(range ?? ""))
  if (!match) throw new Error("ENVIRONMENT_RUNTIME_PORT_RANGE_WALL")
  const first = Number(match[1])
  const last = Number(match[2])
  if (first < 1024 || last > 65535 || first > last || last - first > 999) {
    throw new Error("ENVIRONMENT_RUNTIME_PORT_RANGE_WALL")
  }
  const value = crypto.createHash("sha256").update(worldId).digest().readUInt32BE(0)
  return first + (value % (last - first + 1))
}

export function environmentPublicUrl(template, { port, worldId }) {
  if (typeof template !== "string" || !template.includes("{worldId}")) {
    throw new Error("ENVIRONMENT_RUNTIME_PUBLIC_URL_WALL")
  }
  const rendered = template
    .replaceAll("{port}", String(port))
    .replaceAll("{worldId}", encodeURIComponent(worldId))
  let url
  try { url = new URL(rendered) } catch { throw new Error("ENVIRONMENT_RUNTIME_PUBLIC_URL_WALL") }
  const loopback = url.hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  if ((!loopback && url.protocol !== "https:") || !/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("ENVIRONMENT_RUNTIME_PUBLIC_URL_WALL")
  }
  return url.toString()
}

export function buildValidationReceipt({ tree, gates, buildId, strict, recordedAt }) {
  return { schemaVersion: 1, tree, gates: [...gates].sort(), buildId, strict, recordedAt }
}

export function requireEnvironmentValidationReceipt({ receipt, tree, buildId, validators }) {
  const gates = new Set(Array.isArray(receipt?.gates) ? receipt.gates : [])
  if (receipt?.schemaVersion !== 1 || receipt.strict !== true || receipt.tree !== tree ||
      receipt.buildId !== buildId || !validators.includes("test") || !validators.includes("build") ||
      !gates.has("test") || !gates.has("build")) {
    throw new Error("ENVIRONMENT_RUNTIME_VALIDATION_BINDING_WALL")
  }
}

export function buildEndpointRuntimeRequest({
  worldId,
  workOrderRef,
  grantRef,
  resourceIdentity,
  workspace,
  branch,
  head,
  port,
  publicUrl,
  evidenceRef,
  capturedAt,
}) {
  return {
    action: "admit_endpoint",
    worldId,
    workOrderRef,
    grantRef,
    endpoint: {
      id: `environment-${safe(worldId)}-${head.slice(0, 12)}`,
      worldId,
      resourceIdentity,
      sandboxId: `worktree-${safe(workOrderRef)}-${head.slice(0, 12)}`,
      probeUrl: `http://127.0.0.1:${port}`,
      appUrl: publicUrl,
      branch,
      head,
      filesystemRoot: workspace,
      terminalStreamRef: `runtime-log://${safe(worldId)}/${head.slice(0, 12)}`,
      testStreamRef: `validation://${safe(workOrderRef)}/${head.slice(0, 12)}`,
      provenance: { source: "execution_receipt", evidenceRef, capturedAt },
    },
  }
}

export function buildObservationRuntimeRequest({ endpointRequest, evidenceRef, validators, changedPaths }) {
  const { worldId, workOrderRef, grantRef, endpoint } = endpointRequest
  return {
    action: "observe_execution",
    worldId,
    workOrderRef,
    grantRef,
    observation: {
      worldId,
      endpointId: endpoint.id,
      outcome: "succeeded",
      summary: "The governed change and its required validation completed in the isolated running workspace. Review is still pending.",
      evidenceRefs: [evidenceRef],
      artifacts: [
        {
          artifactRef: `diff:${endpoint.head}`,
          evidenceRef,
          kind: "diff",
          subject: "Changes in the isolated workspace",
          content: { branch: endpoint.branch, head: endpoint.head, changedPaths },
        },
        {
          artifactRef: `tests:${endpoint.head}`,
          evidenceRef,
          kind: "tests",
          subject: "Required validation",
          content: { validators, result: "PASS" },
        },
      ],
    },
  }
}

function safe(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
}
