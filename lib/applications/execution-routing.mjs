export const DEFAULT_APPLICATION_EXECUTION_ROUTE = "hermes-local"

const ROUTES = Object.freeze([
  Object.freeze({
    id: DEFAULT_APPLICATION_EXECUTION_ROUTE,
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

const enabled = (value) => value === true || value === "1" || value === "true"

export function createApplicationExecutionRouting({
  errorPrefix = "APPLICATION",
  externalEnabledDefault = () => process.env.WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED
    ?? process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
} = {}) {
  if (typeof errorPrefix !== "string" || !/^[A-Z][A-Z0-9_]{2,50}$/.test(errorPrefix)
    || typeof externalEnabledDefault !== "function") throw new Error("APPLICATION_EXECUTION_ROUTING_INVALID")
  const list = ({ externalEnabled = externalEnabledDefault() } = {}) => {
    const available = enabled(externalEnabled)
    return ROUTES.map((route) => ({ ...route, available: !route.external || available }))
  }
  const resolve = (routeId, { externalEnabled = externalEnabledDefault(), externalEgressApproved = false } = {}) => {
    const selectedId = routeId === undefined ? DEFAULT_APPLICATION_EXECUTION_ROUTE : routeId
    if (typeof selectedId !== "string") throw new Error(`${errorPrefix}_EXECUTION_ROUTE_INVALID`)
    const selected = ROUTES.find((route) => route.id === selectedId)
    if (!selected) throw new Error(`${errorPrefix}_EXECUTION_ROUTE_INVALID`)
    if (selected.external && !enabled(externalEnabled)) throw new Error(`${errorPrefix}_EXECUTION_ROUTE_UNAVAILABLE`)
    if (selected.external && externalEgressApproved !== true) {
      throw new Error(`${errorPrefix}_EXTERNAL_EGRESS_APPROVAL_REQUIRED`)
    }
    return {
      id: selected.id,
      provider: selected.provider,
      model: selected.model,
      external: selected.external,
      metered: selected.metered,
    }
  }
  return Object.freeze({ defaultRoute: DEFAULT_APPLICATION_EXECUTION_ROUTE, list, resolve })
}

const applicationRouting = createApplicationExecutionRouting()
export const listApplicationExecutionRoutes = (options) => applicationRouting.list(options)
export const resolveApplicationExecutionRoute = (routeId, options) => applicationRouting.resolve(routeId, options)
