import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("GitHub local identity contract", () => {
  it("requires browser-backed system storage and the expected principal", () => {
    const status = fs.readFileSync("scripts/local/williamos-github-auth-status.ps1", "utf8")
    expect(status).toContain("GITHUB_ENV_TOKEN_WALL")
    expect(status).toContain("GITHUB_PLAINTEXT_FALLBACK_WALL")
    expect(status).toContain("GITHUB_PRINCIPAL_WALL")
    expect(status).toContain("READY_BROWSER_KEYRING_ACCOUNT_$ExpectedAccount")
    expect(status).toContain("gh auth status --hostname github.com")
    expect(status).not.toContain("gh auth token")
  })
})
