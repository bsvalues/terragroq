import {
  DEFAULT_APPLICATION_EXECUTION_ROUTE,
  createApplicationExecutionRouting,
} from "../applications/execution-routing.mjs"

export const DEFAULT_HELLO_EXECUTION_ROUTE = DEFAULT_APPLICATION_EXECUTION_ROUTE

const helloRouting = createApplicationExecutionRouting({
  errorPrefix: "HELLO",
  externalEnabledDefault: () => process.env.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED,
})

export const listHelloExecutionRoutes = (options) => helloRouting.list(options)
export const resolveHelloExecutionRoute = (routeId, options) => helloRouting.resolve(routeId, options)
