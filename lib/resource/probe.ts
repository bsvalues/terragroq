import type { ResourceRecord } from "@/lib/resource/resolve"

/**
 * Look at a declared artefact, and only in the ways the catalogue allows.
 *
 * #871 boundary 5. Every verdict before this one is derived from what was written down. Confirming the
 * 738 GB restore is still on ATLAS, or that the backup still verifies, means contacting a node -- and
 * the only mechanism for that today is an agent opening a shell, which #871 defines as a failed run.
 *
 * This is the boundary where the whole outcome can quietly invert. A dispatch surface that accepts a
 * command is indistinguishable from the shell the agent was told not to use; it just moves the shell
 * inside the product and calls it governance. So nothing here composes a command from caller input:
 *
 *   - the probe is chosen from a fixed catalogue, by KIND, never by text;
 *   - the target path comes from the resource record, never from a request;
 *   - the node comes from the record's identity prefix, never from inference;
 *   - a path that could influence a shell is refused rather than escaped and hoped for.
 *
 * If it can run something the record did not declare, it is wrong.
 */

/** Probes are read-only by construction. Adding one that writes would defeat the point of the seam. */
export const PROBE_KINDS = ["exists-size"] as const
export type ProbeKind = (typeof PROBE_KINDS)[number]

export interface ProbeTarget {
  identity: string
  node: string
  path: string
  kind: ProbeKind
  /** Bytes recorded in the resource record, when the label states a size. */
  recordedBytes: number | null
}

export interface ProbeObservation {
  identity: string
  node: string
  path: string
  exists: boolean
  observedBytes: number | null
  recordedBytes: number | null
  agrees: boolean | null
  detail: string
}

/**
 * Paths that cannot influence a shell.
 *
 * Refusing is deliberate rather than quoting-and-hoping. These strings come from a governed record, but
 * a record is edited by people and agents, and "the data is trusted" is how a data path becomes an
 * execution path.
 */
const SAFE_PATH = /^[A-Za-z0-9._/\\:@+~-]{1,512}$/

export function isSafeProbePath(path: string): boolean {
  return SAFE_PATH.test(path)
}

/**
 * A path must be absolute to be probeable.
 *
 * A shell-quoted "~" is a literal tilde, not a home directory, so probing "~/x" reported a file that
 * plainly exists as MISSING -- a contradiction manufactured by the probe itself. Expanding it instead
 * would be worse: whose home, on which node, under which service account. A record that wants an
 * artefact checked must say where it is.
 */
export function isAbsoluteProbePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\/]/.test(path)
}

export interface ProbeSkip {
  identity: string
  reason: "NO_NODE" | "PATH_NOT_ABSOLUTE" | "PATH_REFUSED"
}

/** Read a byte count out of a label such as "102,359,101,440 bytes". */
export function recordedBytesFrom(label: string): number | null {
  const match = /([0-9][0-9,]{3,})\s*bytes/i.exec(label)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ""))
  return Number.isFinite(value) ? value : null
}

/**
 * Which artefacts of a record can be looked at, and where.
 *
 * Only entries whose identity names a node are probeable: a bare path does not say which machine to ask,
 * and choosing one would be the inference this whole outcome exists to replace.
 */
export function probeTargetsFor(record: ResourceRecord): ProbeTarget[] {
  const candidates = [
    ...record.completionEvidence.map((item) => ({ identity: item.identity, label: item.label })),
    ...record.sources.map((item) => ({ identity: item.identity, label: item.label })),
  ]
  const targets: ProbeTarget[] = []
  for (const candidate of candidates) {
    const separator = candidate.identity.indexOf(":")
    if (separator <= 0) continue
    const node = candidate.identity.slice(0, separator).trim().toLowerCase()
    const path = candidate.identity.slice(separator + 1).trim()
    if (!/^[a-z0-9-]+$/.test(node) || !isSafeProbePath(path) || !isAbsoluteProbePath(path)) continue
    targets.push({
      identity: candidate.identity,
      node,
      path,
      kind: "exists-size",
      recordedBytes: recordedBytesFrom(candidate.label),
    })
  }
  return targets
}

/**
 * The command for a probe kind.
 *
 * A total function over the catalogue, taking only a validated path. There is no branch here that
 * accepts caller text, and adding one would be the defect this module exists to prevent.
 */
/**
 * What could not be looked at, and why.
 *
 * Reported rather than dropped: a verification that silently skips half a record reads as a clean bill
 * of health, which is worse than not checking at all.
 */
export function probeSkips(record: ResourceRecord): ProbeSkip[] {
  const candidates = [
    ...record.completionEvidence.map((item) => item.identity),
    ...record.sources.map((item) => item.identity),
  ]
  const skips: ProbeSkip[] = []
  for (const identity of candidates) {
    const separator = identity.indexOf(":")
    if (separator <= 0) {
      skips.push({ identity, reason: "NO_NODE" })
      continue
    }
    const path = identity.slice(separator + 1).trim()
    if (!isSafeProbePath(path)) skips.push({ identity, reason: "PATH_REFUSED" })
    else if (!isAbsoluteProbePath(path)) skips.push({ identity, reason: "PATH_NOT_ABSOLUTE" })
  }
  return skips
}

export function probeCommand(target: ProbeTarget): string {
  if (!isSafeProbePath(target.path) || !isAbsoluteProbePath(target.path)) throw new Error("PROBE_PATH_REFUSED")
  switch (target.kind) {
    case "exists-size":
      // Directories report their apparent size; files report bytes. Both answer "is it still there".
      return `if [ -e '${target.path}' ]; then du -sb '${target.path}' 2>/dev/null | cut -f1; else echo MISSING; fi`
  }
}

/** Turn raw probe output into an observation, comparing against what the record claimed. */
export function readObservation(target: ProbeTarget, stdout: string): ProbeObservation {
  const output = stdout.trim()
  if (!output || output === "MISSING") {
    return {
      identity: target.identity,
      node: target.node,
      path: target.path,
      exists: false,
      observedBytes: null,
      recordedBytes: target.recordedBytes,
      agrees: false,
      detail: `${target.identity} is recorded but was not found on ${target.node}`,
    }
  }
  const observedBytes = Number(output.split(/\s+/)[0])
  if (!Number.isFinite(observedBytes)) {
    return {
      identity: target.identity,
      node: target.node,
      path: target.path,
      exists: true,
      observedBytes: null,
      recordedBytes: target.recordedBytes,
      agrees: null,
      detail: `${target.identity} exists on ${target.node}; its size could not be read`,
    }
  }
  if (target.recordedBytes === null) {
    return {
      identity: target.identity,
      node: target.node,
      path: target.path,
      exists: true,
      observedBytes,
      recordedBytes: null,
      // No recorded size means nothing to agree or disagree with. Saying "agrees" would invent a check
      // that never happened.
      agrees: null,
      detail: `${target.identity} exists on ${target.node} at ${observedBytes} bytes; the record states no size`,
    }
  }
  const agrees = observedBytes === target.recordedBytes
  return {
    identity: target.identity,
    node: target.node,
    path: target.path,
    exists: true,
    observedBytes,
    recordedBytes: target.recordedBytes,
    agrees,
    detail: agrees
      ? `${target.identity} is present on ${target.node} at the recorded ${observedBytes} bytes`
      : `${target.identity} is present on ${target.node} at ${observedBytes} bytes, but the record states ${target.recordedBytes}`,
  }
}
