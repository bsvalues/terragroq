import { describe, expect, it } from "vitest"

import { decodeCliXml, meaningfulSshError } from "@/lib/fabric/run-baseline.mjs"

const NL = String.fromCharCode(10)
const CLIXML_HEADER = "#< CLIXML"

describe("PowerShell CLIXML error output", () => {
  it("recovers the sentence a node actually reported", () => {
    // Reported verbatim this reads as "#< CLIXML", which names the transport encoding rather than
    // the fault -- the operator learns nothing about their machine.
    const payload = CLIXML_HEADER + NL + "<Objs><S S=\"Error\">docker : error during connect_x000D__x000A_</S></Objs>"
    expect(decodeCliXml(payload)).toBe("docker : error during connect")
  })

  it("joins multiple fragments in order", () => {
    const payload = CLIXML_HEADER + NL + "<Objs><S S=\"Error\">first_x000D__x000A_</S><S S=\"Error\">second</S></Objs>"
    expect(decodeCliXml(payload)).toBe("first" + NL + "second")
  })

  it("unescapes XML entities so the text reads as written", () => {
    const payload = CLIXML_HEADER + NL + "<Objs><S S=\"Error\">a &lt;b&gt; &amp; c</S></Objs>"
    expect(decodeCliXml(payload)).toBe("a <b> & c")
  })

  it("leaves ordinary stderr untouched", () => {
    const plain = "ssh: connect to host omen.local port 22: Connection refused"
    expect(decodeCliXml(plain)).toBe(plain)
  })

  it("returns the payload unchanged when it is CLIXML with no readable fragments", () => {
    // Better to show something odd than to silently report an empty failure.
    const payload = CLIXML_HEADER + NL + "<Objs></Objs>"
    expect(decodeCliXml(payload)).toContain("Objs")
  })

  it("feeds the decoded text through the advisory filter", () => {
    const payload = CLIXML_HEADER + NL + "<Objs><S S=\"Error\">** WARNING: advisory_x000D__x000A_Permission denied (publickey).</S></Objs>"
    expect(meaningfulSshError(payload)).toBe("Permission denied (publickey).")
  })
})
