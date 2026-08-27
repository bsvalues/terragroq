import crypto from "node:crypto"

import type { NodeIdentityContract } from "./node-identity-contract"
import { canonicalNodeIdForHostname } from "./node-identity-contract"
import type { SystemObject } from "./system-object"

/**
 * The first governed mutation whose subject is a canonical `SystemObject`.
 *
 * WHY THIS EXISTS AT ALL, since the charter says choose rather than build. Two bounded recorded
 * searches ran first and both returned nothing:
 * `williamos-experience-v2-gate2-first-action-search-record.md` at `053a33bd`, and
 * `williamos-experience-v2-first-action-pickup-search-record.md` at this action's own base. Building
 * became permitted only through charter `AMENDMENT-001`, under an explicit recorded owner decision,
 * and only because absence was proven twice. The retained sentence of that same charter section --
 * "Do not invent an unsafe action to satisfy the demo" -- binds harder now than it did before the
 * amendment, not less, and it is the reason this file writes one small file and reads it back rather
 * than restarting, draining or evicting anything.
 *
 * WHAT IT DOES. It writes the lab's canonical record OF a node ONTO that node -- node id, hostname,
 * owner-directed role, and when it was written -- and then proves, by a separate observation, that
 * the bytes now on the node are exactly the bytes it meant to write.
 *
 * WHY THAT AND NOT SOMETHING MORE IMPRESSIVE. The action's meaning must not exceed its mechanism. A
 * `drain` that no scheduler honours would be a claim with nothing behind it -- an action with a story
 * about its effect, which is the same failure class as an action with a story about its evidence.
 * This action's entire meaning is "this file now contains this", and that is fully observable. The
 * mechanism itself is not novel either: writing a payload to a node and verifying its digest THERE is
 * the baseline gate's proven push/pull step, which has already run against live hardware.
 *
 * WHAT IT IS NOT. The stamp is written BY the canonical projection and is never read back AS one. A
 * file on a node may not tell this lab which node that machine is: `system-object.ts` refuses to let
 * a local record mint an identity, and a stamp that became an identity source would reintroduce that
 * exact hole from the other side. Nothing in the projection path reads this file, and
 * `tests/system-node-identity-stamp` asserts it.
 *
 * The eleven qualifying criteria of #995 map onto this file as follows. Intrinsic ones are structural
 * here: the operation is chosen from `SYSTEM_OBJECT_MUTATIONS` by name (4); the target is derived
 * from the canonical `NodeObject` and the reviewed transport record, never from a request (5); unsafe
 * values are REFUSED rather than escaped (6); nothing is deleted, ever (6); and one file of a few
 * hundred bytes, overwritten with a fresh equivalent, is reversible and small (11). Selection (3) and
 * the `SystemObject` subject (2) are the caller's to supply and are enforced by the route. Brokered
 * dialect-aware execution (7), session-user scoping (8), durable evidence (9) and verified post-state
 * (10) are the route's, and the last of them is why `verifyCommand` exists separately from
 * `stampCommand`.
 */

/**
 * The fixed catalogue. One entry, chosen by name.
 *
 * A second entry here is not forbidden, but it is not free either: the charter's reuse-first rule
 * survived `AMENDMENT-001` intact, so a lane adding one must first prove, by its own bounded recorded
 * search, that nothing existing serves its subject.
 */
export const SYSTEM_OBJECT_MUTATIONS = ["node.stamp-identity"] as const
export type SystemObjectMutation = (typeof SYSTEM_OBJECT_MUTATIONS)[number]

/** The stamp's own schema version. Read back and checked; a stamp of another shape is not this one. */
export const STAMP_CONTRACT = "williamos-node-stamp/1" as const

/**
 * Where the stamp lives, per dialect. Fixed, and deliberately not a parameter.
 *
 * Under the operator's own profile rather than a system location: this action needs no elevation on
 * either platform, and an action that quietly requires administrator rights to succeed is one that
 * fails differently on every node. `.williamos` is the directory convention the fabric root already
 * uses.
 */
export const STAMP_PATHS = {
  windows: "$env:USERPROFILE\\.williamos\\node-identity.json",
  posix: "$HOME/.williamos/node-identity.json",
} as const

export type NodeDialect = keyof typeof STAMP_PATHS

/**
 * Values that may appear in a stamp. Anything else is refused rather than escaped.
 *
 * The content is carried to the node as base64 and decoded there, so no character in it can reach a
 * shell in the first place. These still exist, and the reason is `lib/resource/mutation.ts`: it is
 * held up as the model precisely because it refuses, and `resident-gh` is disqualified precisely
 * because it escapes. Encoding is a transport property that a later refactor could change; refusal is
 * a property of the action.
 */
const SAFE_NODE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const SAFE_HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/
const SAFE_ROLE = /^[a-z0-9][a-z0-9-]{0,126}$/
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const SHA256_HEX = /^[0-9a-f]{64}$/

export interface StampPlan {
  operation: SystemObjectMutation
  objectId: string
  nodeId: string
  hostname: string
  role: string
  dialect: NodeDialect
  /** The literal path expression the command resolves on the node. Not caller-supplied. */
  path: string
  /** Exactly the bytes that will exist on the node afterwards. */
  content: string
  /** SHA-256 of `content`, computed here so the node's own digest can be compared against it. */
  digest: string
  byteLength: number
}

export type StampRefusal =
  | "NOT_A_NODE"
  | "NODE_ID_REFUSED"
  | "HOSTNAME_REFUSED"
  | "ROLE_REFUSED"
  | "TRANSPORT_ABSENT"
  | "STAMPED_AT_REFUSED"

export interface StampVerdict {
  ok: boolean
  refusal?: StampRefusal
  detail?: string
  plan: StampPlan | null
}

/**
 * The dialect a node speaks, decided the way the broker itself decides it.
 *
 * `brokeredExec` runs a `transport: "local"` node through `powershell -NoProfile -Command`
 * unconditionally (`lib/fabric/broker.mjs`), and only a remote node's `os` selects between the
 * PowerShell and POSIX encodings. So a local node speaks PowerShell whatever its `os` says, and
 * reading `os` alone would build a POSIX command for a node the broker is about to hand to
 * PowerShell. Transport is not dialect -- conflating the two is what once made the baseline gate
 * report the Windows cockpit as unmanageable -- but for the local case the broker's own choice IS the
 * dialect, and this mirrors it rather than guessing beside it.
 */
export function dialectFor(record: { transport?: unknown; os?: unknown }): NodeDialect {
  if (record.transport === "local") return "windows"
  return record.os === "windows" ? "windows" : "posix"
}

/**
 * What the stamp will say, derived entirely from the canonical record.
 *
 * Every field comes from the projected `NodeObject`: the node id and owner-directed role from the
 * reviewed Fabric inventory, the hostname from the same projection. No field is readable from a
 * request, which is why the route can accept a body and still be unable to influence what gets
 * written.
 */
export function planIdentityStamp(
  object: SystemObject,
  record: { transport?: unknown; os?: unknown },
  options: { stampedAt: string },
): StampVerdict {
  if (object.kind !== "NODE") {
    return { ok: false, refusal: "NOT_A_NODE", detail: `object ${object.objectId} is a ${object.kind}`, plan: null }
  }
  // Value safety is checked BEFORE reachability, and the order is deliberate. A node id carrying a
  // shell metacharacter is refused because of what it is, not because of whether the node happens to
  // be addressable today -- and refusing it as `TRANSPORT_ABSENT` would report the least interesting
  // true thing about it.
  if (!SAFE_NODE_ID.test(object.nodeId)) {
    return { ok: false, refusal: "NODE_ID_REFUSED", detail: `node id ${object.nodeId} is not a plain identifier`, plan: null }
  }
  if (!SAFE_HOSTNAME.test(object.hostname)) {
    return { ok: false, refusal: "HOSTNAME_REFUSED", detail: `hostname ${object.hostname} is not a plain hostname`, plan: null }
  }
  if (!SAFE_ROLE.test(object.role)) {
    return { ok: false, refusal: "ROLE_REFUSED", detail: `role ${object.role} is not a plain identifier`, plan: null }
  }
  if (!SAFE_TIMESTAMP.test(options.stampedAt)) {
    return { ok: false, refusal: "STAMPED_AT_REFUSED", detail: "stampedAt is not an ISO-8601 UTC instant", plan: null }
  }
  if (object.transport.state !== "present") {
    return {
      ok: false,
      refusal: "TRANSPORT_ABSENT",
      detail: "no transport record names this node, so there is no endpoint to act through",
      plan: null,
    }
  }

  const dialect = dialectFor(record)
  // Key order is fixed by this literal, so the same node stamped at the same instant produces the
  // same bytes and therefore the same digest. A stamp whose digest depended on property iteration
  // order could not be verified by comparison.
  const content = JSON.stringify({
    contract: STAMP_CONTRACT,
    nodeId: object.nodeId,
    hostname: object.hostname,
    role: object.role,
    stampedAt: options.stampedAt,
  })

  return {
    ok: true,
    plan: {
      operation: "node.stamp-identity",
      objectId: object.objectId,
      nodeId: object.nodeId,
      hostname: object.hostname,
      role: object.role,
      dialect,
      path: STAMP_PATHS[dialect],
      content,
      digest: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
      byteLength: Buffer.byteLength(content, "utf8"),
    },
  }
}

/**
 * Labelled `key=value` lines, the shape every probe in this repository already emits.
 *
 * Chosen over returning the file's contents so that nothing this action reads back is long enough for
 * a host to fold. PowerShell formats pipeline output to a width when stdout is redirected, and a
 * wrapped 200-character JSON body read back as evidence would fail its own comparison for a reason
 * that has nothing to do with the node. A digest and a byte count are 64 and ~3 characters.
 */
export function parseLabelledLines(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of String(text ?? "").split("\n")) {
    const index = line.indexOf("=")
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return fields
}

/**
 * Look before touching: what this machine calls itself, and what stamp it already carries.
 *
 * A read, and the only one of the three commands that runs before the node is changed. The prior
 * digest it returns is the `before` half of this action's evidence -- a hash rather than the content,
 * which is enough to prove a change occurred and carries nothing that needs redacting.
 */
export function observeCommand(dialect: NodeDialect): string {
  if (dialect === "windows") {
    return [
      `$p = Join-Path $env:USERPROFILE '.williamos\\node-identity.json'`,
      `"host=" + $env:COMPUTERNAME`,
      `if (Test-Path -LiteralPath $p -PathType Leaf) { "priorDigest=" + (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower(); "priorBytes=" + (Get-Item -LiteralPath $p).Length } else { "priorDigest="; "priorBytes=0" }`,
    ].join("; ")
  }
  return [
    `f="$HOME/.williamos/node-identity.json"`,
    `echo "host=$(hostname)"`,
    `if [ -f "$f" ]; then echo "priorDigest=$(sha256sum "$f" | cut -d' ' -f1)"; echo "priorBytes=$(wc -c < "$f" | tr -d ' ')"; else echo "priorDigest="; echo "priorBytes=0"; fi`,
  ].join("; ")
}

/**
 * Write the stamp.
 *
 * The content crosses as base64 and is decoded on the node, so no byte of it is ever interpreted by a
 * shell -- the same reason `encodePosix` exists in the broker. The command creates one directory and
 * writes one file. There is no `rm`, no `Remove-Item`, and no `-Force` removal anywhere in it, and
 * `tests/system-node-identity-stamp` asserts that by inspecting the generated string.
 *
 * It reports the digest it observed after writing, and the route DOES NOT accept that as the
 * post-state. A command reporting on its own success is the assumption invariant 12 exists to reject;
 * `verifyCommand` is a separate observation for exactly that reason.
 */
export function stampCommand(plan: StampPlan): string {
  const payload = Buffer.from(assertPlanContent(plan), "utf8").toString("base64")
  if (plan.dialect === "windows") {
    return [
      `$d = Join-Path $env:USERPROFILE '.williamos'`,
      `New-Item -ItemType Directory -Force -Path $d | Out-Null`,
      `$p = Join-Path $d 'node-identity.json'`,
      `[IO.File]::WriteAllBytes($p, [Convert]::FromBase64String('${payload}'))`,
      `"written=" + (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()`,
    ].join("; ")
  }
  return [
    `mkdir -p "$HOME/.williamos"`,
    `printf %s '${payload}' | base64 -d > "$HOME/.williamos/node-identity.json"`,
    `echo "written=$(sha256sum "$HOME/.williamos/node-identity.json" | cut -d' ' -f1)"`,
  ].join(" && ")
}

/**
 * Observe the post-state, as a fact about the node rather than a fact about the write.
 *
 * Deliberately a second round trip. The write already reported a digest; trusting it would make the
 * evidence say what was requested instead of what is there, and would also be unable to notice
 * anything that happened between the two calls. It hashes the file ON the node, so a value that
 * matches is a statement about the bytes that exist, not about our ability to hash.
 *
 * This action can do that because the thing it changes is not the thing doing the observing. The
 * strongest candidate the first search examined, `LOOM_OPERATIONS.service.restart`, failed here
 * irrecoverably: it restarts the process that would observe it, and an action cannot witness its own
 * termination.
 */
export function verifyCommand(dialect: NodeDialect): string {
  if (dialect === "windows") {
    return [
      `$p = Join-Path $env:USERPROFILE '.williamos\\node-identity.json'`,
      `"digest=" + (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()`,
      `"bytes=" + (Get-Item -LiteralPath $p).Length`,
    ].join("; ")
  }
  return [
    `f="$HOME/.williamos/node-identity.json"`,
    `echo "digest=$(sha256sum "$f" | cut -d' ' -f1)"`,
    `echo "bytes=$(wc -c < "$f" | tr -d ' ')"`,
  ].join("; ")
}

export interface PriorStamp {
  observedHostname: string | null
  priorDigest: string | null
  priorBytes: number | null
}

export function readPriorStamp(stdout: string): PriorStamp {
  const fields = parseLabelledLines(stdout)
  const priorDigest = SHA256_HEX.test(fields.priorDigest ?? "") ? fields.priorDigest : null
  const priorBytes = Number.parseInt(fields.priorBytes ?? "", 10)
  return {
    observedHostname: fields.host ? fields.host : null,
    priorDigest,
    priorBytes: Number.isFinite(priorBytes) ? priorBytes : null,
  }
}

export type IdentityVerdict =
  | { ok: true; observedHostname: string; resolvedNodeId: string }
  | { ok: false; refusal: "IDENTITY_UNOBSERVED" | "IDENTITY_MISMATCH"; detail: string }

/**
 * Refuse to mutate a machine that does not answer as the node we selected.
 *
 * The endpoint came from a reviewed transport record and the broker pins its host key, so this is not
 * the only thing standing between a request and the wrong machine. It is the check that closes the
 * remaining gap: a transport record is edited by more than one lane, and a host entry that now points
 * somewhere else would still resolve, still connect, and still be the wrong node.
 *
 * STATED PLAINLY, BECAUSE IT WOULD BE EASY TO OVERSELL. This compares an observed HOSTNAME against
 * the reviewed identity contract. It is weaker than the projection's promotion rule, which matches an
 * observed machine-id digest against the inventory pin, and it promotes nothing: a node this accepts
 * is not thereby `promoted`, and this function is not an identity source. It is the strongest
 * precondition this action can obtain without deploying the canonical probe to the node, and calling
 * it anything more would be the kind of claim the map has caught four times.
 */
export function assertObservedIdentity(
  contract: NodeIdentityContract,
  plan: StampPlan,
  prior: PriorStamp,
): IdentityVerdict {
  if (!prior.observedHostname) {
    return { ok: false, refusal: "IDENTITY_UNOBSERVED", detail: "the endpoint reported no hostname" }
  }
  const resolved = canonicalNodeIdForHostname(contract, prior.observedHostname)
  if (resolved !== plan.nodeId) {
    return {
      ok: false,
      refusal: "IDENTITY_MISMATCH",
      detail:
        `the endpoint answered as "${prior.observedHostname}", which the reviewed identity contract ` +
        `resolves to ${resolved ?? "no canonical node"}, not ${plan.nodeId}`,
    }
  }
  return { ok: true, observedHostname: prior.observedHostname, resolvedNodeId: resolved }
}

export interface PostState {
  verified: boolean
  reason: string
  expectedDigest: string
  observedDigest: string | null
  expectedBytes: number
  observedBytes: number | null
  observedAt: string
}

/**
 * The post-state verdict: did the node end up holding exactly these bytes?
 *
 * Both properties are compared because they fail differently. A digest mismatch means different
 * content; a byte count that disagrees with a matching digest would mean the two readings did not
 * describe the same file, which is worth refusing rather than explaining.
 */
export function verifyPostState(plan: StampPlan, stdout: string, observedAt: string): PostState {
  const fields = parseLabelledLines(stdout)
  const observedDigest = SHA256_HEX.test(fields.digest ?? "") ? fields.digest : null
  const parsedBytes = Number.parseInt(fields.bytes ?? "", 10)
  const observedBytes = Number.isFinite(parsedBytes) ? parsedBytes : null

  const base = {
    expectedDigest: plan.digest,
    observedDigest,
    expectedBytes: plan.byteLength,
    observedBytes,
    observedAt,
  }
  if (observedDigest === null) {
    return { ...base, verified: false, reason: "the node reported no readable digest for the stamp" }
  }
  if (observedDigest !== plan.digest) {
    return { ...base, verified: false, reason: "the bytes on the node are not the bytes that were written" }
  }
  if (observedBytes !== plan.byteLength) {
    return { ...base, verified: false, reason: "the digest matched but the byte count did not; the two readings disagree" }
  }
  return { ...base, verified: true, reason: "the node holds exactly the bytes this action wrote" }
}

/**
 * Last line of defence before the content is encoded.
 *
 * `planIdentityStamp` already refused anything unsafe, so reaching this throw means a `StampPlan` was
 * assembled by something other than the planner. It throws rather than sanitising: a plan this cannot
 * recognise is not a plan to be repaired.
 */
function assertPlanContent(plan: StampPlan): string {
  const parsed = JSON.parse(plan.content) as Record<string, unknown>
  if (parsed.contract !== STAMP_CONTRACT) throw new Error("STAMP_CONTENT_REFUSED: not a stamp")
  if (parsed.nodeId !== plan.nodeId || !SAFE_NODE_ID.test(String(parsed.nodeId))) {
    throw new Error("STAMP_CONTENT_REFUSED: node id does not match the plan")
  }
  if (crypto.createHash("sha256").update(plan.content, "utf8").digest("hex") !== plan.digest) {
    throw new Error("STAMP_CONTENT_REFUSED: content does not hash to the plan's digest")
  }
  return plan.content
}
