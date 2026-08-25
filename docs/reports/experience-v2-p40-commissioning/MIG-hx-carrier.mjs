#!/usr/bin/env node
/**
 * #997 MIGRATION lane — thin local carrier.
 *
 * Every read and every mutation this lane performs on HERMES goes through the STAGED
 * `P40-brokered.mjs` on HERMES, which calls `lib/fabric/broker.mjs` and appends to the lab's one
 * audit ledger. This file does not talk to the GPU, Docker, or Ollama. Its only jobs are:
 *   1. base64 the PowerShell body (PowerShell 5.1 strips inner quotes out of forwarded arguments),
 *   2. hand it to the staged brokered runner over exactly ONE ssh per invocation
 *      (nested ssh on HERMES tears down the outer session — see reference-lab-exec-gotchas),
 *   3. bring the resulting evidence JSON back.
 *
 * usage: node hx.mjs <action> <local-ps1-file> <local-out.json> [--require-audit] [--timeout ms]
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const [action, psFile, outFile] = process.argv.slice(2)
if (!action || !psFile || !outFile) {
  console.error("usage: node hx.mjs <action> <local-ps1> <local-out.json> [--require-audit] [--timeout ms]")
  process.exit(2)
}
const requireAudit = process.argv.includes("--require-audit")
const tIdx = process.argv.indexOf("--timeout")
const timeoutMs = tIdx === -1 ? 300_000 : Number(process.argv[tIdx + 1])

const STAGE = "C:\\Users\\bs\\p40-commissioning"
// The `hermes` ssh alias points at the Tailscale address, which did not come back with the box after
// the acceptance-test reboot. HX_HOSTNAME routes the same alias (same user, same key, same broker on
// the far side) over the LAN address instead: a transport detail, not a different execution path.
const HOST_OVERRIDE = process.env.HX_HOSTNAME ? ["-o", `HostName=${process.env.HX_HOSTNAME}`] : []
const body = fs.readFileSync(psFile, "utf8")
const b64 = Buffer.from(body, "utf8").toString("base64")
const remoteOut = `.artifacts/mig/${path.basename(outFile)}`

// The launcher is STAGED AS A FILE rather than passed as -EncodedCommand. A service-definition
// payload base64s to ~21 KB, and wrapping that in a UTF-16LE-encoded command line blows past
// Windows' 32767-character argv limit -- which fails as ENAMETOOLONG locally, before anything runs.
// Writing the launcher to disk keeps the command line a fixed few hundred bytes at any payload size.
const launcher = [
  `$ErrorActionPreference='Continue'`,
  `Set-Location '${STAGE}'`,
  `$b64 = Get-Content '${STAGE}\\_hx\\payload.b64' -Raw`,
  `node '${STAGE}\\P40-brokered.mjs' hermes '${action}' $b64.Trim() '${remoteOut}'` +
    (requireAudit ? " --require-audit" : "") +
    ` --timeout ${timeoutMs}`,
  `Write-Output ("HX_RC=" + $LASTEXITCODE)`,
].join("\n")

const localTmp = path.join(process.env.TEMP ?? ".", `hx-${process.pid}`)
fs.mkdirSync(localTmp, { recursive: true })
fs.writeFileSync(path.join(localTmp, "payload.b64"), b64, "utf8")
fs.writeFileSync(path.join(localTmp, "launch.ps1"), launcher, "utf8")

function run(bin, args, opts = {}) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs + 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  })
}

let out = ""
try {
  run("ssh", ["-o", "ConnectTimeout=25", ...HOST_OVERRIDE, "hermes", "powershell", "-NoProfile", "-Command", `New-Item -ItemType Directory -Force '${STAGE}\\_hx' | Out-Null`])
  run("scp", ["-o", "ConnectTimeout=25", ...HOST_OVERRIDE, path.join(localTmp, "payload.b64"), path.join(localTmp, "launch.ps1"), `hermes:${STAGE.replace(/\\/g, "/")}/_hx/`])
  out = run("ssh", ["-o", "ConnectTimeout=25", ...HOST_OVERRIDE, "hermes", "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${STAGE}\\_hx\\launch.ps1`])
} catch (error) {
  out = String(error.stdout ?? "") + "\n[hx] ssh error: " + String(error.message)
}
process.stdout.write(out)

// Pull the evidence file back over the same one-ssh-per-call rule.
try {
  execFileSync("scp", ["-o", "ConnectTimeout=25", ...HOST_OVERRIDE, `hermes:${STAGE}/${remoteOut.replace(/\\/g, "/")}`, outFile], {
    encoding: "utf8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  })
  console.log(`\n[hx] evidence -> ${outFile} (${fs.statSync(outFile).size} bytes)`)
} catch (error) {
  console.log(`\n[hx] EVIDENCE FETCH FAILED: ${String(error.message)}`)
  process.exitCode = 1
}
