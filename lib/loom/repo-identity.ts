/**
 * One canonical identity for a repository, whatever form it arrives in.
 *
 * A repository is written at least four ways across this system, and they must all reduce to the
 * same thing or the stale-worktree check inverts itself:
 *
 *   bsvalues/terrafusion_os_1.0                        (the canonical store's slug)
 *   https://github.com/bsvalues/terrafusion_os_1.0.git (https remote)
 *   git@github.com:bsvalues/terrafusion_os_1.0.git     (scp-style ssh remote)
 *   ssh://git@github.com/bsvalues/terrafusion_os_1.0.git (url-style ssh remote)
 *
 * The host is part of the identity, not noise. A bare slug is implicitly GitHub, because that is the
 * provider the canonical resource represents, so it normalises to `github.com/owner/repo`. A remote
 * that names a DIFFERENT host — `gitlab.com/bsvalues/terrafusion_os_1.0` — normalises to
 * `gitlab.com/owner/repo` and must NOT compare equal to the canonical GitHub slug. Dropping the host
 * (an earlier mistake) would let a checkout of the wrong repository on another provider certify as
 * the canonical resource: the stale-tree failure in a nastier form.
 *
 * The rule is strict: reduce every RECOGNISED form to `host/owner/repo`, defaulting a bare slug to
 * github.com, and REFUSE anything else by returning null rather than half-matching it. A confident
 * "these are the same" and a confident "I cannot tell" are both safe; a lenient "close enough" is
 * what lets a checkout of the wrong repository pass for the right one.
 */

const DEFAULT_HOST = "github.com"
const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const HOSTNAME = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/**
 * Reduce a repository reference to `host/owner/repo`, lowercased, or null if it is not a form we
 * recognise well enough to compare. A bare `owner/repo` slug defaults to github.com.
 */
export function canonicalRepoIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  let v = value.trim()
  if (!v) return null

  v = v.replace(/^git\+/i, "")

  let host: string | null = null
  let rest: string

  const scheme = v.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(.*)$/)
  if (scheme) {
    // scheme://[user@]host/owner/repo
    const afterUser = scheme[1].replace(/^[^@/]+@/, "")
    const slash = afterUser.indexOf("/")
    if (slash < 0) return null
    host = afterUser.slice(0, slash).split(":")[0] // drop any :port
    rest = afterUser.slice(slash + 1)
  } else if (/^[^/]+@[^/:]+:/.test(v)) {
    // scp-style: user@host:owner/repo
    const m = v.match(/^[^@]+@([^:]+):(.*)$/)
    if (!m) return null
    host = m[1]
    rest = m[2]
  } else {
    // bare slug: owner/repo, implicitly the default provider
    rest = v
  }

  rest = rest.replace(/\.git$/i, "").replace(/\/+$/, "")
  const segments = rest.split("/").filter(Boolean)
  if (segments.length !== 2) return null

  const [owner, repo] = segments
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repo)) return null

  const resolvedHost = (host ?? DEFAULT_HOST).toLowerCase()
  if (!HOSTNAME.test(resolvedHost)) return null

  return `${resolvedHost}/${owner.toLowerCase()}/${repo.toLowerCase()}`
}

/**
 * Whether two references name the same repository.
 *
 * True only when both reduce to the same canonical `host/owner/repo`. A GitHub slug and its GitHub
 * remote URLs match; a same-path repository on a different host does not; an unrecognisable
 * reference matches nothing. Refuse, do not almost-match.
 */
export function sameRepository(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalRepoIdentity(a)
  const right = canonicalRepoIdentity(b)
  return left != null && left === right
}
