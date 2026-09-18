/** Mask the optional provider in child tools; presence also blocks dotenv restoration. */
export function withoutCerebrasChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment }
  childEnvironment.CEREBRAS_API_KEY = ""
  childEnvironment.WILLIAMOS_CEREBRAS_ENABLED = "false"
  return childEnvironment
}
