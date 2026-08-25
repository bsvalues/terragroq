import { execFile, spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

/**
 * How this plane reaches a node, and nothing about what it is allowed to do there.
 *
 * This file exists because the layering was upside down. `broker.mjs` -- the module whose entire
 * purpose is that it is the ONLY way this application touches a node -- had to import its transport
 * from `run-baseline.mjs`, one of its own callers. That made the obvious fix to the baseline gate's
 * raw `exec("ssh", ...)` calls impossible to write: routing the gate through the broker would have
 * closed an import cycle, so the gate kept a transport the broker never saw, and the map recorded
 * that as a defect for four revisions (`CONT-EXPV2-BASELINE-RAW-TRANSPORT`).
 *
 * Splitting the two concerns removes the cycle rather than working around it. Transport primitives --
 * quoting, encoding, the Windows ssh teardown workaround, the registry reader, the connection policy
 * -- live here, with no opinion about policy. `broker.mjs` imports them and adds the parts that make
 * an action governed: an unknown node is refused, host keys are pinned, and every outcome reaches the
 * ledger. `run-baseline.mjs` then imports the BROKER, the way every other caller does.
 *
 * Nothing here changed behaviour. Every function is the one that shipped, moved verbatim, and
 * `run-baseline.mjs` re-exports all of them so existing importers do not have to move.
 */


const execFileAsync = promisify(execFile)
const isWindows = process.platform === "win32"

/**
 * Windows OpenSSH's client does not finish tearing down its session when its stdout/stderr are pipes
 * or plain file handles supplied by the parent -- it authenticates, runs the command, receives the
 * output and the channel close, and then never exits. Traced side by side at `-vvv`: the piped run
 * stops after "channel 0: rcvd close" at 160 log lines, while the same command with inherited console
 * handles reaches "Exit status 0" at 178 lines in 760ms.
 *
 * That is why no ssh node had ever passed this gate. `reach` was reported as a connection failure,
 * but the connection always succeeded -- the probe was killed by its own timeout during teardown,
 * with the answer already sitting in the channel. It presents as flaky rather than broken because it
 * is a teardown race, so an occasional run does slip through.
 *
 * Letting `cmd.exe` own the redirection sidesteps it: ssh writes to handles the shell created and
 * exits cleanly (measured: 336ms), and node keeps ordinary pipes on cmd itself. Non-Windows hosts run
 * ssh directly, where none of this applies.
 */
export function quoteForCmd(arg) {
  const value = String(arg)
  if (!/[\s"^&|<>()]/.test(value)) return value
  // Escaping only the quote character is not enough. Backslashes are literal in a Windows argument
  // UNTIL they immediately precede a quote, at which point each pair collapses and an odd one escapes
  // the quote itself. A path whose last character is a backslash therefore had its closing
  // quote consumed, and every following argument landed inside the string. Runs of
  // backslashes are doubled before an embedded quote, and before the closing quote.
  const escaped = value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/, '$1$1')
  return `"${escaped}"`
}

/**
 * cmd.exe substitutes %NAME% before the command ever reaches ssh, and it does so inside double
 * quotes too -- measured: "%USERNAME%" arrives as the account name. There is no escape that works in
 * `cmd /c`, so an argument carrying a variable pair cannot be transported safely and is refused
 * rather than silently rewritten. A lone percent (`printf %s`) is left alone by cmd and stays legal,
 * which matters because the push step depends on it.
 */
export function assertNoCmdVariableExpansion(args) {
  for (const arg of args) {
    const match = /%[A-Za-z_][A-Za-z0-9_]*%/.exec(String(arg))
    if (match) {
      throw Object.assign(
        new Error(`CMD_VARIABLE_EXPANSION_UNSAFE: ${match[0]} would be substituted by cmd.exe before ssh sees it`),
        { argument: String(arg), token: match[0] },
      )
    }
  }
}

/** PowerShell's own transport for a command body, so no shell in the chain has to preserve quoting. */
export function encodePowerShell(command) {
  return `powershell -NoProfile -EncodedCommand ${Buffer.from(command, "utf16le").toString("base64")}`
}

export function buildWindowsSshCommand(args, outFile, errFile) {
  assertNoCmdVariableExpansion([...args, outFile, errFile])
  return `ssh ${args.map(quoteForCmd).join(" ")} > ${quoteForCmd(outFile)} 2> ${quoteForCmd(errFile)}`
}

/**
 * End a process AND anything it started.
 *
 * `ChildProcess.kill()` signals only the process node started. On Windows that is cmd.exe, while the
 * work -- and the open file handles -- belong to the ssh process underneath it. Killing the parent
 * alone leaves a probe running against a node after the gate has already declared it timed out.
 */
function killProcessTree(child) {
  if (child.pid && process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 })
    } catch {
      // taskkill missing or refused; fall through to the direct kill rather than leaving it running.
    }
  }
  try { child.kill() } catch { /* already gone */ }
}

/**
 * Pick the line of stderr that actually says what went wrong.
 *
 * OpenSSH writes advisories to stderr -- the post-quantum key-exchange notice, the "Permanently
 * added ... to the list of known hosts" line -- and taking the FIRST line reported one of those as
 * the failure. OMEN showed as failing with "connection is not using a post-quantum key exchange
 * algorithm" while the real cause, Permission denied (publickey), sat two lines below and never
 * surfaced. Diagnosing the wrong thing is worse than reporting nothing: it sends the reader to fix
 * something that is not broken. Advisories are skipped and the last substantive line wins, because
 * ssh prints its fatal reason last.
 */
/**
 * Turn PowerShell's serialized error stream back into the sentence it started as.
 *
 * When a remote PowerShell writes to its error stream over ssh, the payload arrives as CLIXML: a
 * literal "#< CLIXML" header followed by XML, with newlines encoded as _x000D__x000A_. Reported
 * verbatim, a node's failure reads as "#< CLIXML" -- which names the transport encoding rather than
 * the fault, and tells the reader nothing about their machine.
 *
 * The human text lives in <S> elements. This pulls those out and leaves anything that is not CLIXML
 * untouched, so it can sit in front of the existing advisory filter without changing ordinary paths.
 */
export function decodeCliXml(text) {
  const raw = String(text ?? "")
  if (!raw.includes("#< CLIXML")) return raw
  const parts = [...raw.matchAll(/<S[^>]*>([\s\S]*?)<\/S>/g)].map((match) => match[1])
  if (parts.length === 0) return raw
  return parts
    .join("")
    .replace(/_x000D__x000A_/g, String.fromCharCode(10))
    .replace(/_x000D_/g, "")
    .replace(/_x000A_/g, String.fromCharCode(10))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, String.fromCharCode(34))
    .trim()
}

export function meaningfulSshError(stderr) {
  const advisory = [
    /^\s*\*\*/,
    /post-quantum/i,
    /store now, decrypt later/i,
    /may need to be upgraded/i,
    /openssh\.com/i,
    /^Warning: Permanently added/i,
    /^\s*$/,
  ]
  const lines = decodeCliXml(stderr).split(/\r?\n/).filter((line) => !advisory.some((rule) => rule.test(line)))
  return (lines[lines.length - 1] ?? "").trim()
}

/**
 * `crypto` here is the node module, and the import above is load-bearing.
 *
 * When this function moved out of `run-baseline.mjs` its `node:crypto` import did not come with it.
 * In an ES module the bare name still resolves -- to the Web Crypto global, which has no
 * `randomBytes` -- so nothing failed at load and every default ssh execution on the Windows control
 * host threw `crypto.randomBytes is not a function` before ssh was ever spawned: the baseline gate,
 * the brokered probes, every broker caller. A silent global standing in for a missing import is the
 * failure mode worth naming, because the file kept parsing and only the runtime path broke.
 */
async function runSshViaCmd(args, { timeout }) {
  const stamp = crypto.randomBytes(8).toString("hex")
  const outFile = path.join(os.tmpdir(), `fabric-ssh-${stamp}.out`)
  const errFile = path.join(os.tmpdir(), `fabric-ssh-${stamp}.err`)
  const readIfPresent = (file) => {
    try { return fsSync.readFileSync(file, "utf8") } catch { return "" }
  }
  try {
    const code = await new Promise((resolve, reject) => {
      // stdin MUST be "ignore". Node's default is a pipe that is never closed, and ssh waits on it
      // forever -- the wrapper then hangs exactly like the unwrapped client it was added to fix.
      // windowsVerbatimArguments: node otherwise escapes the quotes we added, so cmd hands ssh a
      // literally-quoted remote command and the far shell hunts for a program named
      // `docker ps -q | wc -l`. Verbatim means cmd parses the quoting we intended.
      const child = spawn("cmd", ["/c", buildWindowsSshCommand(args, outFile, errFile)], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      child.stdout?.resume()
      child.stderr?.resume()
      const timer = setTimeout(() => {
        // child.kill() ends cmd.exe and leaves ssh running: Windows has no process-group signal, so
        // the grandchild outlives the parent that was supposed to bound it. The orphan keeps the
        // redirected handles open, which is why deleting the temp files below could fail with EPERM
        // -- that error was the symptom of a still-running probe, not a filesystem quirk. taskkill /T
        // ends the tree; killing the parent afterwards covers the case where taskkill is unavailable.
        killProcessTree(child)
        reject(Object.assign(new Error(`ssh timed out after ${timeout}ms`), { stderr: readIfPresent(errFile), killed: true }))
      }, timeout)
      child.on("error", (error) => { clearTimeout(timer); reject(error) })
      child.on("exit", (value) => { clearTimeout(timer); resolve(value) })
    })
    const stdout = readIfPresent(outFile)
    const stderr = readIfPresent(errFile)
    if (code !== 0) throw Object.assign(new Error(`ssh exited ${code}`), { stderr, stdout, code })
    return { stdout, stderr }
  } finally {
    // Best effort only. The handle can still be held briefly after cmd exits, and an EPERM here was
    // reported as the step's failure -- so a successful probe surfaced as an unreachable node. A
    // temp file we could not delete is a leak; a probe we could not trust is a broken gate.
    for (const file of [outFile, errFile]) {
      try { fsSync.rmSync(file, { force: true }) } catch { /* swept by the OS temp cleaner */ }
    }
  }
}

/** Routes ssh through the cmd wrapper on Windows; everything else goes straight to execFile. */
export function defaultExec(file, args, options) {
  if (isWindows && file === "ssh") return runSshViaCmd(args, options)
  return execFileAsync(file, args, options)
}

export function defaultFabricRoot() {
  return process.env.WILLIAMOS_FABRIC_ROOT ?? path.join(os.homedir(), ".williamos", "fabric")
}

/**
 * The BOM strip is not defensive decoration. The registry is maintained by PowerShell tooling on a
 * Windows control node, and `Set-Content -Encoding UTF8` under Windows PowerShell 5.1 emits a UTF-8
 * BOM -- which `JSON.parse` rejects outright. The registry edit that corrected OMEN's username did
 * exactly that, so every JSON reader of the registry began failing with REGISTRY_UNAVAILABLE,
 * including the very gate the edit was meant to unblock. The reader tolerates what the platform's
 * writers actually produce.
 */
/** Built from the code point rather than typed, because a literal BOM is invisible in source. */
const BOM = String.fromCharCode(0xfeff)

export function parseRegistry(text) {
  return JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text)
}

export async function readRegistry(fabricRoot = defaultFabricRoot()) {
  return parseRegistry(await fs.readFile(path.join(fabricRoot, "nodes.json"), "utf8"))
}

/**
 * The connection policy, in one place.
 *
 * Exported so the broker calls it rather than restating it. StrictHostKeyChecking is deliberate: a
 * plane that accepts a new host key on sight can be answered by whatever currently holds the address,
 * and this lab has watched a node's lease change hands twice in a day.
 */
export function sshArgs(node, command, fabricRoot) {
  return [
    "-i", path.join(fabricRoot, "keys", "williamos-fabric"),
    "-o", `UserKnownHostsFile=${path.join(fabricRoot, "known_hosts")}`,
    "-o", "StrictHostKeyChecking=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    `${node.user}@${node.host}`,
    command,
  ]
}
