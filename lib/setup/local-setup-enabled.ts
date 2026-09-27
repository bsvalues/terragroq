/**
 * Whether the local setup surfaces are enabled in this environment.
 *
 * These routes (`/api/setup/local-config`, `/api/setup/local-status`,
 * `/api/setup/primary-credential`) each carried their own copy of this predicate, and the copies
 * had drifted: two of them omitted the explicit-enable branch, so in a production build they could
 * never be enabled no matter what the operator set. That made the two surfaces an operator needs
 * exactly when they are locked out -- local status, and the primary credential recovery --
 * unreachable in the deployed runtime, while `local-config` alone honoured the setting.
 *
 * The semantics are therefore declared once, here:
 *
 *   LOCAL_SETUP_ENABLED=false      -> disabled, in every environment (an explicit opt-out wins)
 *   LOCAL_SETUP_ENABLED=true       -> enabled, in every environment (an explicit opt-in wins)
 *   unset, NODE_ENV=production     -> disabled (safe default for a deployed runtime)
 *   unset, any other NODE_ENV      -> enabled (a development machine works out of the box)
 */
export function localSetupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LOCAL_SETUP_ENABLED === "false") return false
  if (env.LOCAL_SETUP_ENABLED === "true") return true
  return env.NODE_ENV !== "production"
}

/**
 * Hosts that count as "this machine" for local-setup requests. The caller decides the port/origin
 * comparison; this is only the host half, shared so the three routes cannot disagree about it.
 */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}