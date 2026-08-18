import { describe, expect, it } from "vitest"

import { encodePosix } from "@/lib/fabric/broker.mjs"

describe("posix command transport", () => {
  it("carries a command containing double quotes intact", () => {
    // quoteForCmd escapes an embedded quote the way a C runtime expects, which is not how cmd.exe
    // parses it. A probe containing echo "host=$(hostname)" was torn apart before ssh saw it and the
    // node reported ssh exited 255 with no usable reason.
    const command = String.raw`echo "host=$(hostname)"; echo "cores=$(nproc)"`
    const wrapped = encodePosix(command)
    expect(wrapped).not.toContain(String.fromCharCode(34))
    const b64 = /echo '([A-Za-z0-9+/=]+)'/.exec(wrapped)?.[1] ?? ""
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(command)
  })

  it("emits only characters no shell in the chain reinterprets", () => {
    const wrapped = encodePosix("df -h / | awk '{print $4}'")
    // Single quotes are safe through cmd; double quotes, backslashes and percent pairs are not.
    expect(wrapped).not.toMatch(/[%\\"]/)
  })

  it("round-trips a command with newlines and single quotes", () => {
    const command = "set -e" + String.fromCharCode(10) + "echo 'it'\x27's fine'"
    const b64 = /echo '([A-Za-z0-9+/=]+)'/.exec(encodePosix(command))?.[1] ?? ""
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(command)
  })
})
