/**
 * What a resident cycle failure is allowed to say (#1015).
 *
 * THE DEFECT. `resident-kernel-cli.mjs` matched the error message against a typed-wall pattern and
 * fell back to the bare token `RESIDENT_KERNEL_WALL` for anything it did not recognise. The message
 * was then discarded. Measured on HERMES: 158 KB of `resident.log` containing that one token and
 * nothing else, every five minutes since ATLAS's lease moved -- while the actual failure was
 * `connect ETIMEDOUT 192.168.88.5:15432` inside `loadWorkOrders`.
 *
 * An opaque token is worse than silence, because it looks like a diagnosis. It reads as "the kernel
 * refused" -- a verdict about work -- when the truth was "the database address is stale" -- a fact
 * about plumbing. That is the same structural error the capability lane already forbids: an unknown
 * plumbing failure must stay about plumbing and must never be promoted into a verdict.
 *
 * So an unrecognised failure keeps a typed OUTER class plus a sanitized cause, and the two are
 * reported separately: the class says what kind of thing broke, the cause says what it said.
 *
 * SANITISATION. This string is appended to a log file that is not access-controlled the way the
 * connection string is, so it must never carry credentials or lab addresses. Connection URLs are
 * replaced wholesale and bare IPv4 literals are masked, while ports, error codes and syscall names
 * survive -- those are what make the line actionable.
 */

/** Explicit typed walls the kernel and its adapters already raise; these pass through untouched. */
const TYPED_WALL = /QUARANTINED_TERMINAL|[A-Z][A-Z0-9_]+_WALL/

/** Node/libpq connection failures. A cycle that cannot reach ATLAS has not judged anything. */
const CONNECT_CODES = new Set([
  "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN",
])

export const RESIDENT_KERNEL_WALL = "RESIDENT_KERNEL_WALL"
export const RESIDENT_KERNEL_DATABASE_CONNECT_WALL = "RESIDENT_KERNEL_DATABASE_CONNECT_WALL"

/**
 * Remove anything that identifies a host or carries a secret, keeping the shape of the failure.
 */
export function sanitizeCause(message) {
  return String(message ?? "")
    // Whole connection strings first: they carry the password, and their host would otherwise be
    // masked into something that still looks like a usable URL.
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "<redacted-url>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<authority-host>")
    // Bare lab hostnames. Loopback is not an identity worth hiding and stays legible.
    .replace(/\b(?!localhost\b)[a-z0-9-]+\.(?:local|lan|invalid|internal)\b/gi, "<authority-host>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

/**
 * Classify a cycle failure into a typed outer class plus a sanitized cause.
 *
 * An explicitly typed wall keeps its own name -- those are deliberate refusals with settled meaning.
 * Everything else gets a class that says what KIND of failure it was, so "unknown" never has to mean
 * "unexplained".
 */
export function classifyResidentKernelFailure(error) {
  const message = String(error?.message ?? error ?? "")
  const code = typeof error?.code === "string" && error.code.trim() !== "" ? error.code.trim() : null

  const typed = message.match(TYPED_WALL)?.[0]
  if (typed) return { wall: typed, code, cause: sanitizeCause(message), typed: true }

  // A connection failure is plumbing, and saying so is the whole point of this module.
  if ((code && CONNECT_CODES.has(code)) || /\bconnect\s+E[A-Z]+/.test(message)) {
    return { wall: RESIDENT_KERNEL_DATABASE_CONNECT_WALL, code, cause: sanitizeCause(message), typed: false }
  }

  return { wall: RESIDENT_KERNEL_WALL, code, cause: sanitizeCause(message), typed: false }
}

/** One line, stable field order, safe to append to a shared log. */
export function formatResidentKernelFailure(verdict) {
  const parts = [verdict.wall]
  if (verdict.code) parts.push(`code=${verdict.code}`)
  if (verdict.cause) parts.push(`cause=${verdict.cause}`)
  return parts.join(" ")
}
