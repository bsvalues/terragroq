import { describe, expect, it } from "vitest"

import {
  assertNoCmdVariableExpansion,
  buildWindowsSshCommand,
  quoteForCmd,
} from "@/lib/fabric/run-baseline.mjs"

// A literal backslash is written from its code point throughout: in this repository a backslash in a
// heredoc has been silently eaten more than once, and a test that quietly loses the character it is
// testing proves nothing.
const B = String.fromCharCode(92)

describe("cmd argument quoting", () => {
  it("does not let a trailing backslash swallow the closing quote", () => {
    // Windows collapses backslash pairs before a quote and lets an odd one escape it, so
    // "C:\\Program Files\\fabric\\" ended the argument at the wrong place and every later
    // argument was absorbed into the string.
    const quoted = quoteForCmd("C:" + B + "Program Files" + B + "fabric" + B)
    expect(quoted.endsWith(B + B + String.fromCharCode(34))).toBe(true)
    // The run before the closing quote must be even, or the quote is escaped away. The pattern is
    // built from code points: a regex literal here has already been eaten once by tooling, and a
    // test that loses the character it tests silently passes.
    const trailing = new RegExp("(" + B + B + "+)" + String.fromCharCode(34) + "$").exec(quoted)
    expect(trailing).not.toBeNull()
    expect(trailing![1].length % 2).toBe(0)
  })

  it("leaves an ordinary path untouched", () => {
    expect(quoteForCmd("C:" + B + "fabric" + B + "key")).toBe("C:" + B + "fabric" + B + "key")
  })

  it("still escapes embedded quotes in a remote command", () => {
    const quoted = quoteForCmd(String.raw`echo "host=$(hostname)"`)
    expect(quoted.startsWith(String.fromCharCode(34))).toBe(true)
    expect(quoted).toContain(B + String.fromCharCode(34) + "host=")
  })
})

describe("cmd variable expansion", () => {
  it("refuses an argument cmd would rewrite before ssh sees it", () => {
    // Measured: cmd substitutes %USERNAME% even inside double quotes, and there is no escape that
    // works in `cmd /c`. Refusing beats transporting something different from what was written.
    expect(() => assertNoCmdVariableExpansion(["C:" + B + "Users" + B + "%USERNAME%" + B + "key"]))
      .toThrow(/CMD_VARIABLE_EXPANSION_UNSAFE/)
  })

  it("allows a lone percent, which the push step depends on", () => {
    // `printf %s` is left alone by cmd; refusing it would break the transfer step for no reason.
    expect(() => assertNoCmdVariableExpansion([String.raw`printf %s abc > /tmp/f`])).not.toThrow()
  })

  it("checks the redirection targets too, not only the ssh arguments", () => {
    expect(() => buildWindowsSshCommand(["bs@host", "hostname"], "C:" + B + "%TEMP%" + B + "o.txt", "e.txt"))
      .toThrow(/CMD_VARIABLE_EXPANSION_UNSAFE/)
  })

  it("builds an ordinary command line unchanged", () => {
    const line = buildWindowsSshCommand(["-i", "key", "bs@host", "hostname"], "o.txt", "e.txt")
    expect(line).toBe("ssh -i key bs@host hostname > o.txt 2> e.txt")
  })
})
