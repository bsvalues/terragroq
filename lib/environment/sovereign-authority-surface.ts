import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { getBuildProvenance } from "@/lib/build-provenance"

/**
 * The sovereign Git authority, visible to the owner.
 *
 * Why this exists: the estate cut over to lab Git as the integration authority, and the integration
 * tool records its verdict in `~/.williamos/integrations.json` — the artifact of record that
 * separates what happened from whether the mirror echoed it. Until now that file had no owner-facing
 * surface, so the single most important distinction in the doctrine (product state vs mirror state)
 * was only visible by reading JSON in a terminal. Enforcement outran visibility again.
 *
 * No second source: this module does not restate a policy, a threshold, or an authority it keeps
 * somewhere else. It loads the integration tool's own record and the build provenance the deploy
 * doctrine already publishes, and reports what they actually say. If a record cannot be read, the
 * surface says which record is missing, with a typed reason — an empty list would read as
 * "nothing was ever promoted", which is the worst possible wrong answer.
 *
 * The rule it displays (docs/governance/sovereign-git-authority.md): GitHub availability may not
 * gate product progression, so a mirror failure is reported alongside — never instead of — product
 * completion.
 */

export const AUTHORITY_RULE_ID = "OWNER-LAB-GIT-AUTHORITY-20260911"

export type AuthorityRecord = Readonly<{
  at: string
  candidate: string
  base: string
  labMainBefore: string
  labMainAfter: string
  sealKey: string
  reviewerKey: string
  productState: string
  mirrorState: string
  mirrorDetail: string
}>

export type AuthoritySurface = Readonly<{
  authority: Readonly<{
    rule: typeof AUTHORITY_RULE_ID
    model: "lab-git-authoritative"
    source: string
    note: string
  }>
  runtime: Readonly<{
    buildSha: string
    builtAt: string | null
    provenanceState: "PROVEN_AT_AUTHORITY" | "BUILD_LAGS_AUTHORITY" | "BUILD_UNPROVEN" | "NO_AUTHORITY_RECORD"
    labMainHead: string | null
  }>
  product: Readonly<{ state: string; detail: string; at: string | null; promotions: number }>
  mirror: Readonly<{ state: string; detail: string; at: string | null; laggingSince: string | null }>
  recentPromotions: AuthorityRecord[]
  staleness: Readonly<{ newestRecordAt: string | null; ageHours: number | null }>
}>

export class AuthoritySurfaceUnavailable extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`)
    this.name = "AuthoritySurfaceUnavailable"
  }
}

/**
 * Resolve the state file. The writer (integrate-lab-main.mjs) uses USERPROFILE only; this resolver
 * matches it, with one deliberate addition: WILLIAMOS_INTEGRATIONS_STATE overrides for tests and
 * operator probes, and HOME/homedir as a portable fallback on non-Windows hosts. On the lab host
 * (USERPROFILE set, no override) the two paths are identical — that is the single-source condition;
 * an explicit override is a declared operator action, not a silent divergence.
 */
export function resolveIntegrationsStatePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.WILLIAMOS_INTEGRATIONS_STATE
  if (override) return override
  const home = env.USERPROFILE || env.HOME || os.homedir()
  if (!home) return null
  return path.join(home, ".williamos", "integrations.json")
}

/**
 * Pure projection over the record + the deployed build provenance. Exported separately so tests can
 * feed fixtures and prove both directions (healthy and every refusal) without touching any real
 * record, and so production calls exactly this function on the file it reads.
 */
export function projectAuthorityRecord(
  raw: unknown,
  provenance: { sha: string; builtAt: string | null },
  source: string,
  nowMs = Date.now(),
): AuthoritySurface {
  if (!raw || typeof raw !== "object") {
    throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_MALFORMED", `${source} is not a JSON object`)
  }
  const list = (raw as { integrations?: unknown }).integrations
  if (!Array.isArray(list)) {
    throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_MALFORMED", `${source}.integrations is missing or not an array`)
  }
  // Strict shape: the integration tool always writes every field (verified against every record
  // written since the cutover). A record missing one is not this tool's record — refuse, never fill
  // in a display value the writer never wrote.
  const REQUIRED: (keyof AuthorityRecord)[] = ["at", "candidate", "base", "labMainBefore", "labMainAfter", "sealKey", "reviewerKey", "productState", "mirrorState", "mirrorDetail"]
  const parsed: AuthorityRecord[] = []
  for (const [i, item] of list.entries()) {
    const r = item as Partial<Record<keyof AuthorityRecord, unknown>>
    const missing = REQUIRED.filter((k) => typeof r?.[k] !== "string" || (r[k] as string).length === 0)
    if (missing.length > 0) {
      throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_MALFORMED", `${source}.integrations[${i}] lacks required string field(s): ${missing.join(", ")}`)
    }
    // Rebuild the clean projection — never pass the raw object through: extra keys the writer
    // doesn't emit (a forged `productStateOverride`, junk fields) must not reach the response.
    parsed.push({
      at: r.at as string,
      candidate: r.candidate as string,
      base: r.base as string,
      labMainBefore: r.labMainBefore as string,
      labMainAfter: r.labMainAfter as string,
      sealKey: r.sealKey as string,
      reviewerKey: r.reviewerKey as string,
      productState: r.productState as string,
      mirrorState: r.mirrorState as string,
      mirrorDetail: r.mirrorDetail as string,
    })
  }

  const newest = parsed.at(-1) ?? null

  // Deploy leg: EXACT equality of full shas only — the #762 deploy doctrine treats anything but the
  // built commit as unproven, "never as a pass". Prefix matching is deliberately absent: a "-dirty"
  // build or an abbreviated sha must not read as proven at authority.
  const fullHex = /^[0-9a-f]{40}$/i.test(provenance.sha)
  const unproven = provenance.sha === "development" || provenance.sha === "unknown"
    || provenance.sha.endsWith("-dirty") || !fullHex
  let provenanceState: AuthoritySurface["runtime"]["provenanceState"]
  if (!newest) provenanceState = "NO_AUTHORITY_RECORD"
  else if (unproven) provenanceState = "BUILD_UNPROVEN"
  else if (provenance.sha === newest.labMainAfter) {
    provenanceState = "PROVEN_AT_AUTHORITY"
  } else provenanceState = "BUILD_LAGS_AUTHORITY"

  // Mirror lag: the OLDEST record of the current out-of-sync streak (newest-first walk until the
  // last IN_SYNC echo). If nothing is in sync in the record, the oldest record is the honest floor.
  let laggingSince: string | null = null
  if (newest && newest.mirrorState !== "IN_SYNC") {
    for (const r of [...parsed].reverse()) {
      if (r.mirrorState === "IN_SYNC") break
      laggingSince = r.at
    }
  }

  const newestMs = newest ? Date.parse(newest.at) : NaN
  const ageHours = Number.isFinite(newestMs) ? (nowMs - newestMs) / 3.6e6 : null

  return {
    authority: {
      rule: AUTHORITY_RULE_ID,
      model: "lab-git-authoritative",
      source,
      note: "Local Git is authoritative; GitHub is a downstream mirror and never gates product progression.",
    },
    runtime: { buildSha: provenance.sha, builtAt: provenance.builtAt, provenanceState, labMainHead: newest?.labMainAfter ?? null },
    product: {
      state: newest?.productState ?? "NO_AUTHORITY_RECORD",
      detail: newest ? `lab main ${newest.labMainAfter.slice(0, 10)} via sealed integration ${newest.candidate.slice(0, 10)}` : "no sealed integration recorded yet",
      at: newest?.at ?? null,
      promotions: parsed.length,
    },
    mirror: {
      state: newest?.mirrorState ?? "NO_AUTHORITY_RECORD",
      detail: newest?.mirrorDetail ?? "no mirror attempt recorded",
      at: newest?.at ?? null,
      laggingSince,
    },
    recentPromotions: parsed.slice(-10).reverse(),
    // Facts only: age of the newest record. No threshold verdict — the doctrine defines no staleness
    // window, and a surface-invented one would be a second policy source.
    staleness: {
      newestRecordAt: newest?.at ?? null,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    },
  }
}

/** Production entry: read the record of the real writer + the running build's provenance. */
export async function projectSovereignAuthority(): Promise<AuthoritySurface> {
  const source = resolveIntegrationsStatePath()
  if (!source) {
    throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_UNRESOLVED", "no home directory or WILLIAMOS_INTEGRATIONS_STATE to locate the integration record")
  }
  let text: string
  try {
    text = fs.readFileSync(source, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // Absent and unreadable are different failures with different remedies; asserting "not found"
    // on a permission error would misreport system state.
    if (code === "ENOENT") {
      throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_MISSING", `${source} not found; nothing has been promoted through the lab authority yet, or the record moved`)
    }
    throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_UNREADABLE", `${source} exists but could not be read (${String(code ?? error)})`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new AuthoritySurfaceUnavailable("AUTHORITY_RECORD_UNPARSEABLE", `${source}: ${String(error instanceof Error ? error.message : error)}`)
  }
  return projectAuthorityRecord(raw, getBuildProvenance(), source)
}
