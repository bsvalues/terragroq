import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The authority oracle's service definition, guarded as a contract rather than as prose.
 *
 * None of these assertions would have caught the original defect, because there was no file to
 * assert about — a hand-typed `docker run` pinned to `192.168.88.5` and nothing in the repository
 * knew the container existed. They exist so the defect cannot come back through the definition that
 * replaced it: the class is `CONT-EXPV2-HARDCODED-ADDRESS-CLASS`, and it has now cost this program
 * four separate repairs.
 */
const DIR = path.join(process.cwd(), "deploy", "atlas", "williamos-authority-registry")
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8")

const compose = read("compose.yaml")
const hba = read("pg_hba.conf")
const callers = JSON.parse(read("fabric-callers.json")) as {
  publishedPort: number
  callers: { nodeId: string; cidr: string }[]
}

// The configuration only. `compose.yaml`'s comments recount the failure that produced this file
// and necessarily quote the addresses involved; an assertion that could not tell prose from a
// setting would either fail on the explanation or have to stop explaining.
const composeConfig = compose
  .split(/\r?\n/)
  .map((line) => line.replace(/(^|\s)#.*$/, ""))
  .join("\n")

// Rules only, without the reasoning around them.
const hbaRules = hba
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split(/\s+/))

describe("the publish does not depend on ATLAS's address", () => {
  it("publishes 15432 on every interface", () => {
    expect(composeConfig).toMatch(/^\s+- "0\.0\.0\.0:15432:5432"$/m)
  })

  // The exact shape of the original failure: a literal host address in the binding.
  it("names no literal IPv4 host address anywhere but 0.0.0.0", () => {
    const literals = (composeConfig.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []).filter((a) => a !== "0.0.0.0")
    expect(literals).toEqual([])
  })

  it("keeps the data volume external, so compose cannot create an empty registry beside it", () => {
    expect(composeConfig).toMatch(/external:\s*true/)
    expect(composeConfig).toMatch(/name:\s*williamos_pgdata/)
  })

  it("never re-pulls the image out from under the lab's only authority oracle", () => {
    expect(composeConfig).toMatch(/pull_policy:\s*missing/)
  })

  it("reads its access policy from this directory rather than from inside the volume", () => {
    expect(composeConfig).toMatch(/hba_file=\/etc\/williamos\/pg_hba\.conf/)
    expect(composeConfig).toMatch(/\.\/pg_hba\.conf:\/etc\/williamos\/pg_hba\.conf:ro/)
  })
})

describe("the access policy is default-closed", () => {
  // The line that was actually in force on 2026-08-25: every database, every role, from anywhere.
  it("carries no blanket host rule that authenticates rather than refuses", () => {
    const blanket = hbaRules.filter(([type, db, user, addr, method]) =>
      type?.startsWith("host") && db === "all" && user === "all"
      && ["all", "0.0.0.0/0", "::/0"].includes(addr ?? "") && method !== "reject")
    expect(blanket).toEqual([])
  })

  it("ends by rejecting both address families", () => {
    const tail = hbaRules.slice(-2)
    expect(tail).toEqual([
      ["host", "all", "all", "0.0.0.0/0", "reject"],
      ["host", "all", "all", "::/0", "reject"],
    ])
  })

  it("grants no TCP rule the trust method", () => {
    expect(hbaRules.filter(([type, , , , method]) => type?.startsWith("host") && method === "trust")).toEqual([])
  })

  it("narrows every network grant to one database and one role", () => {
    const grants = hbaRules.filter(([type, , , , method]) => type?.startsWith("host") && method !== "reject")
    expect(grants.length).toBeGreaterThan(0)
    for (const [, db, user] of grants) {
      expect(db).toBe("williamos")
      expect(user).toBe("williamos")
    }
  })
})

describe("the two enforcement points describe one declaration", () => {
  // pg_hba.conf and the DOCKER-USER chain are generated from the same intent by different means.
  // They drift the moment someone adds a caller to one and forgets the other, and a caller present
  // in only one place is either silently refused or silently reachable.
  it("allowlists exactly the callers fabric-callers.json declares", () => {
    const inHba = hbaRules
      .filter(([type, , , , method]) => type?.startsWith("host") && method !== "reject")
      .map(([, , , addr]) => addr)
    expect([...inHba].sort()).toEqual([...callers.callers.map((c) => c.cidr)].sort())
  })

  it("declares at least one caller, so neither layer can be applied empty", () => {
    expect(callers.callers.length).toBeGreaterThan(0)
  })

  it("agrees with compose on the published port", () => {
    expect(callers.publishedPort).toBe(15432)
  })
})

describe("the restriction has an owner that survives a reboot", () => {
  const unit = read("williamos-authority-firewall.service")

  it("re-applies at boot, after docker", () => {
    expect(unit).toMatch(/After=.*docker\.service/)
    expect(unit).toMatch(/ExecStart=.*apply-network-policy\.sh apply/)
  })

  // A unit that reported `active` over an unfiltered port would be the same shape as the backup
  // mechanisms that reported success while protecting nothing.
  it("verifies what it installed instead of assuming it took", () => {
    expect(unit).toMatch(/ExecStartPost=.*apply-network-policy\.sh check/)
  })
})

// Flushing the live chain and refilling it rule by rule leaves tcp/15432 OPEN for the length of the
// gap, and open permanently if any one append fails -- `set -e` exits with the flush already done.
// The whole policy is replaced in one `iptables-restore` transaction instead. This is asserted about
// the script's text because CI has no iptables to run it against, and a guarantee with no test at
// all is how the first version of this file came to contain the thing its own header denied.
describe("applying the policy cannot leave the port open part-way through", () => {
  const script = read("apply-network-policy.sh")
  // The commentary explains the defect at length and necessarily quotes the commands that caused
  // it, so the assertions read the executable lines only.
  const code = script
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line) && line.trim() !== "")
    .join("\n")

  it("replaces the chain in one transaction", () => {
    expect(code).toMatch(/iptables-restore\s+--noflush/)
  })

  it("never flushes the chain it is about to rebuild", () => {
    expect(code).not.toMatch(/iptables\s+-F\s+"?\$CHAIN/)
  })

  it("refuses when the binary that makes the replacement atomic is absent", () => {
    expect(code).toMatch(/command -v iptables-restore/)
    expect(script).toMatch(/IPTABLES_RESTORE_MISSING/)
  })

  it("re-reads what it installed rather than trusting the exit codes", () => {
    expect(code).toMatch(/POLICY_APPLIED_BUT_DIFFERS/)
  })
})
