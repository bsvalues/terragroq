#!/usr/bin/node
import { spawnSync } from "node:child_process"

const ENV = Object.freeze({ HOME: "/nonexistent", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" })
const TABLE = "williamos_aegis_remote_dev"
const RULES = [
  'add rule inet williamos_aegis_remote_dev output meta skuid "williamos-fabric" ip daddr 192.168.1.156 reject',
  'add rule inet williamos_aegis_remote_dev output meta skuid "williamos-fabric" ip6 daddr ::ffff:192.168.1.156 reject',
  'add rule inet williamos_aegis_remote_dev output meta skuid "williamos-fabric" ip daddr 127.0.0.1 tcp dport 17734 accept',
  'add rule inet williamos_aegis_remote_dev output meta skuid "williamos-fabric" reject',
]

function run(args, input) {
  const result = spawnSync("/usr/sbin/nft", args, { encoding: "utf8", shell: false, timeout: 5000, maxBuffer: 1_048_576, env: ENV, input })
  if (result.error || result.status !== 0) throw new Error("fixed nft enforcement failed")
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
    run(["-c", "-f", "-"], `${lines.join("\n")}\n`)
    run(["-f", "-"], `${lines.join("\n")}\n`)
  } catch {
    process.exitCode = 2
  }
}
