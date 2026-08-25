import { readNodes } from "./registry.mjs"
import { defaultFabricRoot } from "./run-baseline.mjs"

/**
 * Resolve the authority registry's connection string against the canonical fabric registry.
 *
 * THE DEFECT THIS CLOSES. HERMES's `.env.local` carried
 * `postgresql://williamos:***@192.168.88.5:15432/williamos`. When ATLAS's DHCP lease moved to
 * `192.168.88.8`, that line went on naming a machine that is now a different device — so the lab's
 * one authority oracle became unreadable, and the governed route correctly refused every mutation
 * behind it. The same class of failure had already broken cross-node backups (`sync-models-to-forge`
 * hard-coding `bs@192.168.88.5`) and `known_hosts`. `CONT-EXPV2-HARDCODED-ADDRESS-CLASS`.
 *
 * The registry already knows where ATLAS is, and `#1006` proved that answer against two independent
 * identity checks before writing it. So the address stops being configuration and becomes a lookup.
 *
 * NO FALLBACK, DELIBERATELY. Every refusal below is terminal. A fallback to the address in the
 * source string is precisely how a stale value survives the repair that was supposed to remove it:
 * it would work on the day it was written, and quietly resume being wrong the day the lease moves.
 * "The registry could not answer" is a reason to stop, not a reason to guess.
 *
 * WHAT IS AND IS NOT SUBSTITUTED. Only the host. The role, the password, the port, the database and
 * every query parameter are carried through byte-for-byte from the source, because this function's
 * job is to answer "where is ATLAS" and nothing else. It never logs, returns, or derives anything
 * from the password.
 */

export class AuthorityRegistryUrlError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = "AuthorityRegistryUrlError"
    this.code = code
  }
}

/** The canonical node id of the machine that holds the authority registry. */
export const AUTHORITY_REGISTRY_NODE = "atlas"

/** Replace a connection string's password with `***`, for logs and evidence. */
export function redactUrl(url) {
  return String(url).replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@")
}

/**
 * Read `DATABASE_URL` out of a dotenv-style file.
 *
 * Deliberately not a general dotenv parser: it takes the LAST assignment, which is what a process
 * loading the same file would use, and it strips one layer of matching quotes and nothing else.
 */
export function readDatabaseUrlFromEnv(text, source = "<env>") {
  const lines = String(text).split(/\r?\n/)
  let value = null
  for (const line of lines) {
    const match = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let raw = match[1].trim()
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1)
    }
    value = raw
  }
  if (!value) {
    throw new AuthorityRegistryUrlError(
      "SOURCE_ENV_NO_DATABASE_URL",
      `${source} carries no DATABASE_URL assignment, so there is no connection to resolve`,
    )
  }
  return value
}

/**
 * Substitute the host of `databaseUrl` with the address the fabric registry holds for ATLAS.
 *
 * Returns `{ url, host, previousHost, fabricRoot, fingerprint, changed }`. `fingerprint` is the
 * registry's content hash, so evidence can prove which registry state the answer came from.
 */
export async function resolveAuthorityRegistryUrl(databaseUrl, options = {}) {
  const fabricRoot = options.fabricRoot ?? defaultFabricRoot()
  const nodeId = options.nodeId ?? AUTHORITY_REGISTRY_NODE

  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new AuthorityRegistryUrlError(
      "SOURCE_URL_UNPARSEABLE",
      "the source DATABASE_URL is not a URL, so its host cannot be replaced without rewriting the rest of it",
    )
  }

  let nodes
  let fingerprint
  try {
    ;({ nodes, fingerprint } = await readNodes(fabricRoot))
  } catch (error) {
    throw new AuthorityRegistryUrlError(
      "FABRIC_REGISTRY_UNREADABLE",
      `${fabricRoot} could not be read (${error?.code ?? error?.message ?? error}), so ${nodeId}'s address `
      + "cannot be resolved. Refusing rather than falling back to a written-down address that may now name another machine.",
    )
  }

  const host = nodes?.[nodeId]?.host
  if (typeof host !== "string" || host.trim() === "") {
    throw new AuthorityRegistryUrlError(
      "FABRIC_REGISTRY_INCOMPLETE",
      `the registry at ${fabricRoot} carries no "${nodeId}" entry with a host, so the authority registry cannot be addressed. Refusing rather than guessing.`,
    )
  }

  const declared = host.trim()
  const previousHost = parsed.hostname

  // A bare IPv6 literal is a legitimate thing for the registry to hold and NOT a legitimate value
  // for `URL.hostname`, which wants it bracketed. Bracket it here rather than refuse it.
  const candidate = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/.test(declared) && !declared.startsWith("[")
    ? `[${declared}]`
    : declared

  // Assigning through `URL.hostname` keeps the rest of the string — credentials, port, database,
  // query — exactly as the source had them. It also FAILS SILENTLY: given a value the URL parser
  // will not accept (`::1`, `a b`, `host:port`, an empty string) it throws nothing and leaves the
  // previous hostname in place. That is this module's single worst failure mode, because the value
  // left in place is the stale address this function exists to stop trusting, and the caller would
  // be told `changed: true` with the registry's host echoed back at it while holding a URL pointing
  // at the machine that used to be ATLAS. So the assignment is verified rather than assumed.
  //
  // The check cannot be "did `parsed.hostname` change", because the registry legitimately answering
  // with the address the source already held is a no-op assignment and a success. So the value is
  // offered to a throwaway URL whose hostname is one nothing can resolve to, and rejection is read
  // as "the sentinel survived". What comes back out of the probe is also the parser's OWN
  // normalisation (case-folded, IDNA-encoded), which is what makes the comparison below safe for a
  // registry that writes `ATLAS` rather than `atlas`.
  const SENTINEL = "unresolvable-probe.invalid"
  const probe = new URL(`postgresql://${SENTINEL}/`)
  try {
    probe.hostname = candidate
  } catch {
    probe.hostname = SENTINEL
  }
  if (probe.hostname === SENTINEL && candidate.toLowerCase() !== SENTINEL) {
    throw new AuthorityRegistryUrlError(
      "FABRIC_REGISTRY_HOST_UNUSABLE",
      `the registry at ${fabricRoot} gives ${nodeId} the host ${JSON.stringify(declared)}, which is not a `
      + "host a connection URL can carry. Refusing rather than returning the source URL's own address, "
      + "which is the stale value this resolution exists to replace.",
    )
  }
  parsed.hostname = probe.hostname

  return {
    url: parsed.toString(),
    host: declared,
    previousHost,
    changed: previousHost !== parsed.hostname,
    fabricRoot,
    nodeId,
    fingerprint,
  }
}
