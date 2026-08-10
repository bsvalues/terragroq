import crypto from "node:crypto"

import { canonicalizeJcs } from "../canonical-json.mjs"

const ENDPOINT = "http://127.0.0.1:11434/api/generate"
const RESIDENT_IDENTITY = "resident-hermes@hermes-node"
const MAX_RESPONSE_BYTES = 65_536

export class HermesLoopbackInferenceError extends Error {
  constructor(code, detail = code) {
    super(`${code}: ${detail}`)
    this.name = "HermesLoopbackInferenceError"
    this.code = code
  }
}

function fail(code, detail) {
  throw new HermesLoopbackInferenceError(code, detail)
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function exactTemplate(template) {
  if (!template || template.id !== "hermes-loopback-local-inference-v1"
    || template.canonical_node !== "hermes-node"
    || template.endpoint !== ENDPOINT
    || template.model !== "llama3.2:3b"
    || template.maximum_calls !== 1
    || !Number.isSafeInteger(template.timeout_seconds) || template.timeout_seconds < 1 || template.timeout_seconds > 60
    || template.redirect_policy !== "error"
    || template.resource_ceilings?.response_limit_bytes !== MAX_RESPONSE_BYTES
    || template.stream !== false
    || template.expected_marker !== "HERMES_DISPATCH_001_OK"
    || typeof template.prompt_sha256 !== "string") fail("HERMES_TEMPLATE_INVALID")
}

export function buildHermesLoopbackRequest({ template, promptBytes, trustedIdentity }) {
  exactTemplate(template)
  if (trustedIdentity !== RESIDENT_IDENTITY) fail("HERMES_IDENTITY_MISMATCH")
  if (!Buffer.isBuffer(promptBytes) || sha256(promptBytes) !== template.prompt_sha256) {
    fail("HERMES_PROMPT_DIGEST_MISMATCH")
  }
  const prompt = promptBytes.toString("utf8")
  if (Buffer.from(prompt, "utf8").length !== promptBytes.length) fail("HERMES_PROMPT_ENCODING_INVALID")
  const body = Buffer.from(canonicalizeJcs({
    model: template.model,
    options: { num_predict: 32, temperature: 0 },
    prompt,
    stream: false,
  }), "utf8")
  return Object.freeze({
    endpoint: ENDPOINT,
    body,
    request_sha256: sha256(body),
    timeout_seconds: template.timeout_seconds,
  })
}

export async function executeHermesLoopbackInference({
  template,
  promptBytes,
  trustedIdentity,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
}) {
  if (typeof fetchImpl !== "function") fail("HERMES_FETCH_UNAVAILABLE")
  const request = buildHermesLoopbackRequest({ template, promptBytes, trustedIdentity })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), request.timeout_seconds * 1000)
  const startedAt = new Date(clock()).toISOString()
  try {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: request.body,
      redirect: "error",
      signal: controller.signal,
    })
    if (!response || response.status !== 200 || response.redirected === true) fail("HERMES_RESPONSE_REJECTED")
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES) fail("HERMES_RESPONSE_SIZE_INVALID")
    let value
    try { value = JSON.parse(bytes.toString("utf8")) } catch { fail("HERMES_RESPONSE_JSON_INVALID") }
    if (!value || typeof value !== "object" || Array.isArray(value)
      || value.model !== template.model || value.done !== true || typeof value.response !== "string") {
      fail("HERMES_RESPONSE_SHAPE_INVALID")
    }
    if (value.response.trim() !== template.expected_marker) fail("HERMES_EXPECTED_MARKER_MISSING")
    return Object.freeze({
      schema_version: "0.1-hermes-loopback-inference-result",
      status: "COMPLETE",
      selected_node_id: "hermes-node",
      template_id: template.id,
      request_sha256: request.request_sha256,
      response_sha256: sha256(bytes),
      response_bytes: bytes.length,
      marker: template.expected_marker,
      started_at: startedAt,
      completed_at: new Date(clock()).toISOString(),
      http_status: response.status,
      calls_performed: 1,
      scheduler_state: "OFF",
      autonomous_dispatch: false,
    })
  } catch (error) {
    if (error instanceof HermesLoopbackInferenceError) throw error
    if (error?.name === "AbortError") fail("HERMES_INFERENCE_TIMEOUT")
    fail("HERMES_TRANSPORT_FAILURE")
  } finally {
    clearTimeout(timeout)
  }
}
