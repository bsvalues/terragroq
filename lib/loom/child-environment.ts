/** Never pass the optional external-provider credential to workspace-controlled tools. */
export function withoutCerebrasChildEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment }
  delete childEnvironment.CEREBRAS_API_KEY
  delete childEnvironment.WILLIAMOS_CEREBRAS_ENABLED
  return childEnvironment
}
