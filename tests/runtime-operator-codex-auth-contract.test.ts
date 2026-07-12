import fs from "node:fs"
import { describe, expect, it } from "vitest"

describe("Codex local identity contract", () => {
  it("pins versions and requires ChatGPT plus keyring without scripting login", () => {
    const versions = JSON.parse(fs.readFileSync("runtime-operator/tool-versions.json", "utf8"))
    expect(versions).toMatchObject({ codexCli: "0.142.2", githubCli: "2.89.0", updatePolicy: "reviewed-work-order-only" })
    const config = fs.readFileSync("scripts/local/williamos-codex-auth-config.ps1", "utf8")
    expect(config).toContain('Set-RootTomlValue "forced_login_method" "chatgpt"')
    expect(config).toContain('Set-RootTomlValue "cli_auth_credentials_store" "keyring"')
    expect(config).toContain("PLAINTEXT_FALLBACK_WALL")
    expect(config).not.toMatch(/codex\s+login(?:\s|$)/)
  })

  it("reports sanitized readiness without exposing credential output", () => {
    const status = fs.readFileSync("scripts/local/williamos-codex-auth-status.ps1", "utf8")
    expect(status).toContain("codex login status")
    expect(status).toContain("CODEX_AUTH_STATUS=OWNER_LOGIN_REQUIRED")
    expect(status).toContain("CODEX_AUTH_STATUS=READY_CHATGPT_KEYRING")
    expect(status).not.toContain("Write-Output $status")
  })
})
