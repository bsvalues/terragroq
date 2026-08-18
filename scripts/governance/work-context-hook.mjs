#!/usr/bin/env node
import fs from "node:fs"
import { register } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * PreToolUse enforcement of WO-WILLIAMOS-FRONTIER-AGENT-PREEXECUTION-GATE for Claude Code.
 *
 * #831 settled one shared WORK_CONTEXT_RECEIPT contract and wired the packet/invoker chokepoint for
 * Codex and AEGIS. Claude Code needs its own attachment point for the same contract, because its
 * effects do not travel through a packet -- it edits files directly. The honest place to enforce that
 * is where tools are granted, not in a prompt: a rule an agent reads is a rule it can rationalise
 * past, and the whole premise of the gate is that "prose loses to convenience every time". A hook is
 * executed by the harness before the tool runs, so it is not something the model can decline.
 *
 * This deliberately imports `lib/governance/work-context-receipt.ts` rather than reimplementing it.
 * A second validator would be a second source of truth, which is the exact failure the receipt design
 * calls out.
 *
 * How much this proves depends on how the receipt was ISSUED, and the mode is recorded rather than
 * assumed:
 *
 *   ledger  the cockpit issued it against an owner-recorded authority grant and wrote the claims to
 *           the governance event log. The hook resolves the facts back FROM the ledger, so the local
 *           file holds nothing but an opaque token and editing it widens nothing.
 *   local   this machine minted it. Premises are complete and staleness is still automatic, but no
 *           authority was checked and no claim was recorded, so it stops drift and scope creep --
 *           not a determined forger.
 *
 * Local exists because the cockpit path needs a device credential the owner enrols once, and a gate
 * that cannot be used until then is a gate that gets switched off.
 */

export const RECEIPT_RELATIVE_PATH = path.join(".williamos", "work-context.json")

/** Tools whose whole purpose is to change a file. */
export const MUTATING_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"])

/**
 * Shell commands that produce a consequential effect.
 *
 * Gating every shell command would make the gate unusable and push work into whatever path is not
 * gated. These are the ones that publish, rewrite history, or destroy -- the effects the Work Order
 * discipline exists for.
 */
export const CONSEQUENTIAL_COMMANDS = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bgit\s+merge\b/,
  /\bgit\s+rebase\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgh\s+pr\s+(create|merge)\b/,
  /\bgh\s+release\s+create\b/,
  /\bnpm\s+publish\b/,
  /\brm\s+-[a-z]*[rf]/,
  /\bRemove-Item\b/i,
]

const TARGET_KEYS = ["file_path", "notebook_path", "path"]

function targetOf(toolInput) {
  for (const key of TARGET_KEYS) {
    const value = toolInput?.[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return null
}

/** Is `child` inside `parent`? Compared on resolved paths so `..` cannot walk out. */
export function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/**
 * Decide whether this tool call needs a proven work context.
 *
 * Reads are never gated -- `requiresWorkContext` is explicit that gating them would push agents
 * toward working blind, which is the opposite of the intent.
 */
export function classifyToolCall({ toolName, toolInput = {}, projectRoot }) {
  if (MUTATING_TOOLS.has(toolName)) {
    const target = targetOf(toolInput)
    if (!target) return { gated: true, target: null, reason: `${toolName} without a resolvable target path` }

    // Outside the repository is not a repository mutation. Scratch files and notes are not the thing
    // the Work Order discipline governs.
    if (!isInside(projectRoot, target)) return { gated: false, target, reason: "outside the project root" }

    // Bootstrap: the receipt itself must be writable, or a lane can never establish context at all.
    // Scoped to this one exact path so it cannot serve as a general bypass.
    if (path.resolve(target) === path.resolve(projectRoot, RECEIPT_RELATIVE_PATH)) {
      return { gated: false, target, reason: "the work context receipt itself" }
    }
    return { gated: true, target, reason: `${toolName} mutates a tracked path` }
  }

  if (toolName === "Bash" || toolName === "PowerShell") {
    const command = String(toolInput?.command ?? "")
    const matched = CONSEQUENTIAL_COMMANDS.find((pattern) => pattern.test(command))
    if (matched) return { gated: true, target: null, reason: `consequential command: ${matched.source}` }
    return { gated: false, target: null, reason: "read-only or local command" }
  }

  return { gated: false, target: null, reason: "non-mutating tool" }
}

/** A mutation outside the reservation is a scope collision, decided here rather than argued later. */
export function reservationVerdict(target, reservedPaths, projectRoot) {
  if (!target) return { ok: true }
  const reserved = Array.isArray(reservedPaths) ? reservedPaths : []
  if (reserved.length === 0) return { ok: false, detail: "the receipt reserves no paths" }
  const allowed = reserved.some((entry) => isInside(path.resolve(projectRoot, entry), target))
  if (allowed) return { ok: true }
  return {
    ok: false,
    detail: `${path.relative(projectRoot, target) || target} is outside the reserved paths (${reserved.join(", ")})`,
  }
}

export function formatRefusal({ failure, detail }) {
  return [
    `BLOCKED ${failure}: ${detail}`,
    "",
    "This lane has not proven its work context, so it may not mutate. Reads are not gated.",
    "",
    "Establish it:",
    "  npm run work-context -- --work-order <WO> --parent-outcome <outcome> --authority <level> \\",
    "      --reserve <path> [--reserve <path>] --subsystem none-found|integrating|superseding \\",
    "      --topology canonical-registry|live-probe --remaining <what the parent still needs>",
    "",
    `That writes ${RECEIPT_RELATIVE_PATH}. Editing it by hand will not work: the facts are hashed into`,
    "the token, so widening the reservation invalidates it.",
  ].join("\n")
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

function deny(message) {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

async function main() {
  const projectRoot = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()

  let event
  try {
    event = JSON.parse((await readStdin()) || "{}")
  } catch {
    // An unparseable event must not become an open gate.
    deny(formatRefusal({ failure: "FAILED_CONTEXT_NOT_PROVEN", detail: "the hook event could not be parsed" }))
    return
  }

  const decision = classifyToolCall({
    toolName: event.tool_name,
    toolInput: event.tool_input,
    projectRoot,
  })
  if (!decision.gated) process.exit(0)

  // Overridable so the routing can be exercised against a fixture. This grants no new power: a lane
  // already controls the default receipt file, and a ledger-provenance token still has to exist in
  // the ledger to verify.
  const receiptPath = process.env.WILLIAMOS_WORK_CONTEXT_RECEIPT
    ?? path.join(projectRoot, RECEIPT_RELATIVE_PATH)
  let claim
  try {
    claim = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
  } catch {
    deny(formatRefusal({
      failure: "FAILED_CONTEXT_NOT_PROVEN",
      detail: `no work context receipt at ${RECEIPT_RELATIVE_PATH} (blocked ${decision.reason})`,
    }))
    return
  }

  // The real validator, imported through the alias loader -- not a copy of it. The loader is
  // registered first because work-context-receipt.ts imports `@/lib/governance/hash`, and plain Node
  // has no tsconfig to resolve that with.
  register(
    pathToFileURL(path.join(projectRoot, "scripts", "governance", "ts-alias-loader.mjs")).href,
    import.meta.url,
  )
  const { verifyWorkContextReceipt } = await import(
    pathToFileURL(path.join(projectRoot, "lib", "governance", "work-context-receipt.ts")).href
  )
  const { measureLiveWorkContext } = await import(
    pathToFileURL(path.join(projectRoot, "lib", "governance", "work-context-live.ts")).href
  )

  const live = await measureLiveWorkContext()
  if (!live) {
    deny(formatRefusal({ failure: "FAILED_STALE_MAIN", detail: "current origin/main could not be measured" }))
    return
  }

  // How the receipt is verified follows how it was ISSUED.
  //
  // A ledger-provenance receipt is resolved from the cockpit: the facts come back from the governance
  // event, so this file holds nothing but an opaque token and cannot be edited to widen anything. A
  // local-provenance receipt can only be checked against its own claims, which is weaker and is why
  // the mode is recorded rather than assumed.
  let facts = claim?.facts
  let verdict
  if (claim?.provenance === "ledger") {
    try {
      const { openDeviceSession, requestJson, DEFAULT_COCKPIT } = await import("./device-session.mjs")
      const cockpit = claim.cockpit ?? DEFAULT_COCKPIT
      const session = await openDeviceSession({ baseUrl: cockpit, projectRoot })
      const looked = await requestJson(
        `${cockpit}/api/governance/work-context?receipt=${encodeURIComponent(String(claim.receipt))}`,
        { cookie: session.cookie, origin: session.origin },
      )
      if (looked.status !== 200 || !looked.json?.facts) {
        deny(formatRefusal({
          failure: "FAILED_CONTEXT_NOT_PROVEN",
          detail: `the ledger does not hold that receipt (HTTP ${looked.status})`,
        }))
        return
      }
      facts = looked.json.facts
    } catch (error) {
      // An unreadable ledger must not become an open gate.
      deny(formatRefusal({
        failure: "FAILED_CONTEXT_NOT_PROVEN",
        detail: `the receipt ledger could not be read: ${error?.message ?? error}`,
      }))
      return
    }
    // Ledger facts are authoritative, so a mismatch here is drift by construction -- no issuance
    // context is supplied, which is exactly how requireWorkContext() reads it.
    verdict = verifyWorkContextReceipt(claim.receipt, {
      ...facts,
      mainSha: live.mainSha,
      doctrineDigest: live.doctrineDigest,
    })
  } else {
    // The claim carries the values it was issued against, so a stale receipt and a doctored one can be
    // told apart -- they have different remedies, and reporting both as "main has moved" pointed a
    // tampered claim at the wrong fix.
    //
    // The third argument is lane-supplied here, which is safe: live main and doctrine are substituted
    // over it before verification, so it never widens what passes. It is consulted only after a
    // mismatch has been decided, and only to choose which refusal to report.
    verdict = verifyWorkContextReceipt(
      claim?.receipt,
      { ...facts, mainSha: live.mainSha, doctrineDigest: live.doctrineDigest },
      { mainSha: facts?.mainSha, doctrineDigest: facts?.doctrineDigest },
    )
  }
  if (!verdict.ok) {
    deny(formatRefusal({ failure: verdict.failure, detail: verdict.detail }))
    return
  }

  const reservation = reservationVerdict(decision.target, facts?.reservedPaths, projectRoot)
  if (!reservation.ok) {
    deny(formatRefusal({ failure: "FAILED_SCOPE_COLLISION", detail: reservation.detail }))
    return
  }

  process.exit(0)
}

// Only run when executed as the hook, so the pure helpers above stay importable by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    deny(formatRefusal({ failure: "FAILED_CONTEXT_NOT_PROVEN", detail: `hook error: ${error?.message ?? error}` }))
  })
}
