#!/usr/bin/node
import { spawnSync } from "node:child_process"
import fs from "node:fs"

const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" })
const TABLE = "williamos_aegis_remote_dev"
const RULES = [
  `add rule inet ${TABLE} output meta skuid "williamos-fabric" ip daddr 192.168.1.156 reject`,
  `add rule inet ${TABLE} output meta skuid "williamos-fabric" ip6 daddr ::ffff:192.168.1.156 reject`,
  `add rule inet ${TABLE} output meta skuid "williamos-fabric" ip daddr 127.0.0.1 tcp dport 17734 accept`,
  `add rule inet ${TABLE} output meta skuid "williamos-git-broker" ip daddr 127.0.0.1 tcp dport 17734 accept`,
  `add rule inet ${TABLE} output ip daddr 127.0.0.1 tcp dport 17734 reject`,
  `add rule inet ${TABLE} output meta skuid "williamos-fabric" reject`,
]

function run(args) {
  const result = spawnSync("/usr/sbin/nft", args, { encoding: "utf8", shell: false, timeout: 5000, maxBuffer: 1_048_576, env: ENV })
  if (result.error || result.signal || result.status !== 0) throw new Error(`fixed nft enforcement failed: status=${result.status ?? "null"} signal=${result.signal ?? "null"} error=${result.error?.code ?? "none"} stderr=${String(result.stderr ?? "").trim() || "empty"}`)
  return result.stdout ?? ""
}

if (process.platform !== "linux" || process.getuid?.() !== 0 || process.argv.length !== 3 || process.argv[2] !== "--enforce") {
  process.exitCode = 64
} else {
  try {
    const exists = spawnSync("/usr/sbin/nft", ["list", "table", "inet", TABLE], { encoding: "utf8", shell: false, timeout: 5000, env: ENV })
    if (exists.error || ![0, 1].includes(exists.status)) throw new Error("fixed nft state query failed")
    const lines = exists.status === 0
      ? [`flush chain inet ${TABLE} output`, ...RULES]
      : [`add table inet ${TABLE}`, `add chain inet ${TABLE} output { type filter hook output priority filter; policy accept; }`, ...RULES]
    const transaction = `/run/williamos-aegis-remote-dev-egress/egress-enforcement-${process.pid}.nft`
    const handle = fs.openSync(transaction, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o400)
    try {
      fs.writeFileSync(handle, `${lines.join("\n")}\n`); fs.fsyncSync(handle); fs.closeSync(handle)
      run(["-c", "-f", transaction]); run(["-f", transaction])
    } finally { try { fs.closeSync(handle) } catch {}; fs.rmSync(transaction, { force: true }) }
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exitCode = 2
  }
}
