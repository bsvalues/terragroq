import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.join(process.cwd(), "cockpit")
const readJson = <T>(relativePath: string) => JSON.parse(
  readFileSync(path.join(root, relativePath), "utf8"),
) as T

describe("thin Tauri cockpit contract", () => {
  it("pins one exact HTTPS HERMES origin and the device endpoint contract", () => {
    const config = readJson<{
      hermesOrigin: string
      startupPath: string
      endpoints: Record<string, string>
    }>("cockpit.config.json")

    expect(config).toEqual({
      hermesOrigin: "https://williamos.lan:3443",
      startupPath: "/device-bootstrap",
      endpoints: {
        enrollmentChallenge: "/api/device/enrollment/challenge",
        enrollmentComplete: "/api/device/enrollment/complete",
        sessionChallenge: "/api/device/session/challenge",
        sessionComplete: "/api/device/session/complete",
      },
    })
    expect(new URL(config.hermesOrigin).origin).toBe(config.hermesOrigin)
    expect(new URL(config.hermesOrigin).protocol).toBe("https:")
  })

  it("grants the exact remote origin only the four device-proof invokes", () => {
    const capability = readJson<{
      remote: { urls: string[] }
      permissions: string[]
    }>("src-tauri/capabilities/remote-cockpit.json")

    expect(capability.remote.urls).toEqual(["https://williamos.lan:3443/*"])
    expect(capability.permissions).toEqual([
      "allow-device-generate-key",
      "allow-device-bind-credential",
      "allow-device-credential",
      "allow-device-sign",
    ])
    expect(JSON.stringify(capability)).not.toMatch(/fs:|shell:|http:|sql|database|git/i)
  })

  it("builds Windows MSI and NSIS bundles with production devtools disabled", () => {
    const tauri = readJson<{
      app: { windows: unknown[]; withGlobalTauri: boolean; security: { capabilities: string[] } }
      bundle: { active: boolean; targets: string[]; resources: Record<string, string> }
    }>("src-tauri/tauri.conf.json")

    expect(tauri.app.windows).toEqual([])
    expect(tauri.app.withGlobalTauri).toBe(true)
    expect(tauri.app.security.capabilities).toEqual(["remote-cockpit"])
    expect(tauri.bundle).toMatchObject({ active: true, targets: ["msi", "nsis"] })
    expect(tauri.bundle.resources).toEqual({
      "target/release/WebView2Loader.dll": "",
    })
  })

  it("keeps the local recovery page informational and credential-free", () => {
    const recovery = readFileSync(path.join(root, "ui/index.html"), "utf8")

    expect(recovery).toContain("WilliamOS Cockpit")
    expect(recovery).toContain("Reconnect")
    expect(recovery).toContain('href="https://williamos.lan:3443/device-bootstrap"')
    expect(recovery).not.toMatch(/<form|<input|password|access[_ -]?token|session[_ -]?token/i)
  })
})
