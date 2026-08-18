import { describe, expect, it } from "vitest"

import { meaningfulSshError } from "@/lib/fabric/run-baseline.mjs"

// Built from a code point: an escape sequence written literally here has been converted into the
// character it denotes more than once by the tooling in this repository.
const NL = String.fromCharCode(10)

describe("ssh failure diagnosis", () => {
  it("reports the real error, not the advisory printed above it", () => {
    // This exact output had the gate reporting OMEN as failing because of a key-exchange notice,
    // while the actual cause -- an unusable key -- was never shown.
    const stderr = [
      "** WARNING: connection is not using a post-quantum key exchange algorithm.",
      "** This session may be vulnerable to " + String.fromCharCode(34) + "store now, decrypt later" + String.fromCharCode(34) + " attacks.",
      "** The server may need to be upgraded. See https://openssh.com/pq.html",
      "bs@omen.local: Permission denied (publickey,keyboard-interactive).",
    ].join(NL)
    expect(meaningfulSshError(stderr)).toBe("bs@omen.local: Permission denied (publickey,keyboard-interactive).")
  })

  it("skips the known-hosts notice", () => {
    const stderr = ["Warning: Permanently added " + String.fromCharCode(39) + "omen.local" + String.fromCharCode(39) + " (ED25519) to the list of known hosts.", "ssh: connect to host omen.local port 22: Connection refused"].join(NL)
    expect(meaningfulSshError(stderr)).toContain("Connection refused")
  })

  it("returns a single substantive line unchanged", () => {
    expect(meaningfulSshError("ssh: connect to host x port 22: Connection timed out"))
      .toBe("ssh: connect to host x port 22: Connection timed out")
  })

  it("returns empty when there is nothing but advisories, so the caller falls back", () => {
    // An empty result is what lets the caller use error.message instead of printing a warning as
    // though it were the failure.
    expect(meaningfulSshError("** WARNING: something advisory" + NL + "")).toBe("")
    expect(meaningfulSshError(undefined)).toBe("")
    expect(meaningfulSshError(null)).toBe("")
  })

  it("handles CRLF, which is what Windows ssh actually emits", () => {
    const stderr = "** WARNING: advisory" + String.fromCharCode(13) + NL + "Permission denied (publickey)."
    expect(meaningfulSshError(stderr)).toBe("Permission denied (publickey).")
  })
})
