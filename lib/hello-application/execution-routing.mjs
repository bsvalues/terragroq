export const DEFAULT_HELLO_EXECUTION_ROUTE = "hermes-local"

const ROUTES = Object.freeze([
  Object.freeze({
    id: DEFAULT_HELLO_EXECUTION_ROUTE,
    label: "Local HERMES — williamos-qwen3-4b:64k (default)",
    provider: "hermes-local",
    model: "williamos-qwen3-4b:64k",
    external: false,
    metered: false,
  }),
  Object.freeze({
    id: "cerebras-gpt-oss-120b",
    label: "Cerebras — gpt-oss-120b (external, metered)",
    provider: "cerebras",
    model: "gpt-oss-120b",
    external: true,
    metered: true,
  }),
  Object.freeze({
    id: "cerebras-qwen-3-8-27b",
    label: "Cerebras — qwen-3.8-27b (external, metered)",
    provider: "cerebras",
    model: "qwen-3.8-27b",
    external: true,
    metered: true,
  }),
])

/** @param {string | boolean | undefined} value */
function externalRoutingEnabled(value) {
  return value === true || value === "1" || value === "true"
}

/** @param {{externalEnabled?: string | boolean}} [options] */
export function listHelloExecutionRoutes({
  externalEnabled = process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
} = {}) {
  const enabled = externalRoutingEnabled(externalEnabled)
  return ROUTES.map((route) => ({ ...route, available: !route.external || enabled }))
}

/**
 * @param {unknown} routeId
 * @param {{externalEnabled?: string | boolean, externalEgressApproved?: boolean}} [options]
 */
export function resolveHelloExecutionRoute(routeId, {
  externalEnabled = process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
  externalEgressApproved = false,
} = {}) {
  const selectedId = routeId === undefined ? DEFAULT_HELLO_EXECUTION_ROUTE : routeId
  if (typeof selectedId !== "string") throw new Error("HELLO_EXECUTION_ROUTE_INVALID")
  const selected = ROUTES.find((route) => route.id === selectedId)
  if (!selected) throw new Error("HELLO_EXECUTION_ROUTE_INVALID")
  if (selected.external && !externalRoutingEnabled(externalEnabled)) {
    throw new Error("HELLO_EXECUTION_ROUTE_UNAVAILABLE")
  }
  if (selected.external && externalEgressApproved !== true) {
    throw new Error("HELLO_EXTERNAL_EGRESS_APPROVAL_REQUIRED")
  }
  return {
    id: selected.id,
    provider: selected.provider,
    model: selected.model,
    external: selected.external,
    metered: selected.metered,
  }
}
