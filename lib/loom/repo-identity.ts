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
 * The rule is deliberately strict: reduce every RECOGNISED form to `owner/repo`, and REFUSE
 * anything else by returning null rather than half-matching it. A confident "these are the same"
 * and a confident "I cannot tell" are both safe; a lenient "close enough" is what lets a checkout
 * of the wrong repository pass for the right one.
 */

const OWNER_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/**
 * Reduce a repository reference to `owner/repo`, lowercased, or null if it is not a form we
 * recognise well enough to compare.
 */
export function canonicalRepoIdentity(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  let v = value.trim()
  if (!v) return null

  // Strip a wrapping scheme, keeping whatever host+path follows.
  //   ssh://git@github.com/owner/repo(.git)
  //   https://github.com/owner/repo(.git)
  //   git+https://…
  v = v.replace(/^git\+/i, "")
  const scheme = v.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(.*)$/)
  if (scheme) {
    v = scheme[1].replace(/^[^@/]+@/, "") // drop any userinfo (git@)
  } else if (/^[^/]+@[^/:]+:/.test(v)) {
    // scp-style: git@github.com:owner/repo(.git)
    v = v.replace(/^[^@]+@/, "").replace(":", "/")
  }

  v = v.replace(/\.git$/i, "").replace(/\/+$/, "")

  const segments = v.split("/").filter(Boolean)
  if (segments.length < 2) return null

  // A host segment carries a dot (github.com); a bare slug has none. Drop a leading host so both a
  // full remote and a bare slug land on the same owner/repo. Everything BETWEEN host and the final
  // owner/repo (there should be nothing) makes the reference one we do not recognise.
  const hasHost = segments[0].includes(".") || segments[0].includes(":")
  const meaningful = hasHost ? segments.slice(1) : segments
  if (meaningful.length !== 2) return null

  const [owner, repo] = meaningful
  if (!OWNER_REPO.test(owner) || !OWNER_REPO.test(repo)) return null

  return `${owner.toLowerCase()}/${repo.toLowerCase()}`
}

/**
 * Whether two references name the same repository.
 *
 * True only when both reduce to the same canonical `owner/repo`. If either side is unrecognisable
 * the answer is false — refuse, do not almost-match.
 */
export function sameRepository(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalRepoIdentity(a)
  const right = canonicalRepoIdentity(b)
  return left != null && left === right
}
