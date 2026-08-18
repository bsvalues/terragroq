import { execFile, spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { auditFabricAction } from "./audit.mjs"

/**
 * The baseline gate's executor, extracted from the API route so it has more than one way in.
 *
 * #829 gave the gate a button, which made it owner-visible. It also, unintentionally, made the gate
 * owner-*dependent*: the only caller was a session-gated POST handler, so an agent finishing the
 * enrolment lane had nothing to invoke and could only report "ready for you to press". Observability
 * and execution authority are different things, and collapsing them turned an affordance into a
 * blocker. The route keeps its button; this module gives the same six steps a headless entry point.
 *
 * The step semantics live in `baseline.ts` alongside the UI types. They are restated here because a
 * `.mjs` module cannot import the `.ts` one without a build step, and `tests/fabric-baseline-runner`
 * pins the two copies equal -- a drifting gate would silently change what "4/4" means.
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

export const PROBE_CONTAINER = "fabric-baseline-probe"
export const BASELINE_STEP_IDS = ["reach", "containers", "start", "push", "pull", "stop"]

export const STEP_TIMEOUT_MS = 60_000

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

/**
 * Run the six-step acceptance gate against one node.
 *
 * The file steps carry a random payload hashed on both sides rather than a fixed string, so a stale
 * copy left by an earlier run cannot be mistaken for a successful transfer -- "the file is there" and
 * "the file I just sent arrived intact" are different claims, and only the second one means the plane
 * can be trusted to deliver code.
 */
export async function runNodeBaseline(name, node, options = {}) {
  const {
    fabricRoot = defaultFabricRoot(),
    exec = defaultExec,
    stepTimeoutMs = STEP_TIMEOUT_MS,
    // Injectable so a test does not append to the lab's real ledger, and so a caller that already
    // records its own actions can opt out deliberately rather than by forgetting.
    audit = (node, action, rc, detail) => auditFabricAction(fabricRoot, node, action, rc, detail),
  } = options
  const results = []
  // Transport says HOW to reach a node; os says WHAT dialect it speaks. Conflating them sent POSIX
  // commands to OMEN -- a Windows node that happens to be reached over ssh -- and the gate reported
  // `wc: not recognized` as though the cockpit were unmanageable.
  const local = node.transport === "local"
  const windows = node.os === "windows"
  const payload = crypto.randomBytes(32).toString("hex")
  const digest = crypto.createHash("sha256").update(payload).digest("hex")
  const remoteFile = `/tmp/fabric-baseline-${digest.slice(0, 12)}.txt`
  const winFile = `$env:TEMP\\fabric-baseline-${digest.slice(0, 12)}.txt`
  const winPidFile = `$env:TEMP\\fabric-baseline-${digest.slice(0, 12)}.pid`
  // A node declares how it runs work. Nodes that say nothing keep the container behaviour they
  // have always had; only a node declaring "processes" -- a cockpit, deliberately not a service
  // host -- is proved through process lifecycle instead. Defaulting the other way would silently
  // change what the gate means for every existing node.
  const processes = node?.workloads === "processes"

  const step = async (id, action) => {
    const started = Date.now()
    try {
      const detail = await action()
      results.push({ node: name, step: id, ok: true, detail: detail.trim().slice(0, 160), ms: Date.now() - started })
      // Every step is recorded, including the reads. The gate starts and stops a workload on each
      // node, and until now none of that reached the ledger -- the plane's most consequential actions
      // were the only ones it did not write down. Auditing must not be able to fail the step it is
      // describing, so a ledger error is swallowed here rather than turned into a false failure.
      await audit(name, `baseline.${id}`, 0, detail).catch(() => {})
      return true
    } catch (error) {
      // Prefer the substantive stderr line: the first one is routinely an ssh advisory.
      const detail = (meaningfulSshError(error?.stderr) || String(error?.message || "")).slice(0, 160)
      results.push({ node: name, step: id, ok: false, detail, ms: Date.now() - started })
      await audit(name, `baseline.${id}`, error?.code ?? 1, detail).catch(() => {})
      return false
    }
  }

  const sh = async (command) => {
    if (local) {
      const { stdout } = await exec("powershell", ["-NoProfile", "-Command", command], { timeout: stepTimeoutMs, windowsHide: true })
      return stdout
    }
    // A Windows node's ssh shell is cmd.exe, so a PowerShell body would have to survive cmd -> ssh ->
    // cmd quoting intact. -EncodedCommand carries it as base64 and removes the question entirely.
    const remote = windows ? encodePowerShell(command) : command
    const { stdout } = await exec("ssh", sshArgs(node, remote, fabricRoot), { timeout: stepTimeoutMs, windowsHide: true })
    return stdout
  }

  if (!(await step("reach", () => sh(windows ? "$env:COMPUTERNAME" : "hostname")))) return results
  // What "running work" means depends on how the node runs it. A cockpit that is deliberately not a
  // service host still has to be inspectable; requiring a container runtime to prove that made the
  // gate test for installed software rather than for management capability.
  await step("containers", () => sh(
    processes
      ? "(Get-Process | Measure-Object).Count"
      : windows ? "(docker ps -q | Measure-Object).Count" : "docker ps -q | wc -l",
  ))
  await step("start", () => sh(
    processes
      // The pid is written next to the probe file so `stop` can end exactly what `start` began. Finding
      // the process by name later would risk killing something the gate never started.
      ? `$p = Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru; Set-Content -Path "${winPidFile}" -Value $p.Id; "started " + $p.Id`
      : windows
        ? `docker rm -f ${PROBE_CONTAINER} 2>$null | Out-Null; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`
        : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; docker run -d --name ${PROBE_CONTAINER} alpine sleep 60`,
  ))

  // Push: written on the node, then hashed THERE. Hashing locally would only prove we can hash.
  await step("push", async () => {
    const out = windows
      ? await sh(`Set-Content -NoNewline -Path "${winFile}" -Value "${payload}"; (Get-FileHash "${winFile}" -Algorithm SHA256).Hash.ToLower()`)
      : await sh(`printf %s '${payload}' > ${remoteFile} && sha256sum ${remoteFile} | cut -d' ' -f1`)
    const seen = out.trim().split(/\s+/).pop() ?? ""
    if (seen !== digest) throw new Error(`hash mismatch on node: ${seen.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `verified ${digest.slice(0, 12)}`
  })

  // Pull: read the bytes back and hash them here. A round trip that changes the content is a plane
  // that silently corrupts what it moves, which is worse than one that cannot move anything.
  await step("pull", async () => {
    const out = windows
      ? await sh(`Get-Content -Raw "${winFile}"`)
      : await sh(`cat ${remoteFile}`)
    const back = crypto.createHash("sha256").update(out.trim()).digest("hex")
    if (back !== digest) throw new Error(`round trip altered the file: ${back.slice(0, 16)} != ${digest.slice(0, 16)}`)
    return `round trip intact`
  })

  await step("stop", () => sh(
    processes
      // Ending it is not enough: the step must prove it ended, or the plane can start work it cannot
      // stop -- which the step list calls the worst of the three failures.
      ? `$id = [int](Get-Content "${winPidFile}"); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; if (Get-Process -Id $id -ErrorAction SilentlyContinue) { throw "process $id still running" }; Remove-Item "${winPidFile}","${winFile}" -ErrorAction SilentlyContinue; "cleaned"`
      : windows
        ? `docker rm -f ${PROBE_CONTAINER} | Out-Null; Remove-Item "${winFile}" -ErrorAction SilentlyContinue; "cleaned"`
        : `docker rm -f ${PROBE_CONTAINER} >/dev/null 2>&1; rm -f ${remoteFile}; echo cleaned`,
  ))

  return results
}

/**
 * Nodes are probed one at a time.
 *
 * This ran concurrently and every remote node timed out, while the identical probe against a single
 * node returned in ~340ms -- so the concurrency was the fault, not the nodes. A four-node diagnostic
 * gains nothing from parallelism worth a result nobody can trust, and a gate that reports healthy
 * machines as unreachable is worse than a slow one.
 */
export async function runAllBaselines(registry, options = {}) {
  const results = []
  for (const [name, node] of Object.entries(registry)) {
    results.push(...(await runNodeBaseline(name, node, options)))
  }
  return { ranAt: new Date().toISOString(), results }
}

/** A node passes only if every step passed; a partial pass is a fail with a named cause. */
export function nodePassed(results) {
  return BASELINE_STEP_IDS.every((id) => results.some((r) => r.step === id && r.ok))
}

export function summarise({ results }) {
  const byNode = new Map()
  for (const result of results) {
    const list = byNode.get(result.node) ?? []
    list.push(result)
    byNode.set(result.node, list)
  }
  const nodes = [...byNode.entries()].map(([node, list]) => ({
    node,
    passed: nodePassed(list),
    steps: list,
    firstFailure: BASELINE_STEP_IDS.map((id) => list.find((r) => r.step === id))
      .find((r) => !r || !r.ok) ?? null,
  }))
  return { nodes, passedCount: nodes.filter((n) => n.passed).length, total: nodes.length }
}
