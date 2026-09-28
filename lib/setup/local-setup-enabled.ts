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

/**
 * The variable that arms Primary-credential recovery. Read from the PROCESS ENVIRONMENT only.
 *
 * Deliberately NOT named `LOCAL_SETUP_ENABLED` and deliberately NOT written by any setup flow: see
 * `primaryRecoveryEnabled` below for why the distinction is load-bearing rather than cosmetic.
 */
export const PRIMARY_RECOVERY_ENV_VAR = "WILLIAMOS_PRIMARY_RECOVERY"

/**
 * Whether the Primary-credential recovery surface (`/api/setup/primary-credential`) is armed.
 *
 * This is a SEPARATE decision from `localSetupEnabled`, and it must stay separate.
 *
 * `local-config` persists `LOCAL_SETUP_ENABLED="true"` into `.env.local` as a normal part of the
 * full setup flow, and the live launcher carries that file into the production process. Any surface
 * gated on `localSetupEnabled()` is therefore enabled by *the setup flow itself* -- not by an
 * operator deciding to open it -- after the first bootstrap. That is tolerable for the two setup
 * surfaces, which read state and reconfigure the local environment. It is not tolerable for the
 * password-reset route: it is unauthenticated by contract, it rewrites the Primary credential, and
 * it deletes every session for that user. Gating it on the persisted flag would leave a
 * after-bootstrap production deployment accepting an unauthenticated credential reset from any local
 * process that can reach the loopback listener and supply a same-origin `Origin` header.
 *
 * So recovery requires its own opt-in, which normal setup NEVER writes:
 *
 *   WILLIAMOS_PRIMARY_RECOVERY="true" -> armed, in any environment
 *   anything else, including unset   -> refused, in every environment
 *
 * Only the literal string counts, and an absent value can never be enabled by side effect. Because
 * nothing persists it, the operator supplies it to the running process (a restart is required for it
 * to take effect); that is the point -- it is a deliberate, ephemeral recovery action rather than a
 * property of a bootstrapped deployment.
 */
export function primaryRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PRIMARY_RECOVERY_ENV_VAR] === "true"
}