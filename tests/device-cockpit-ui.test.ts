import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

describe("device cockpit web integration", () => {
  it("uses same-origin no-store POSTs and never puts credentials in URLs or storage", () => {
    const source = read("components/device/tauri-device.ts")
    expect(source).toContain('credentials: "same-origin"')
    expect(source).toContain('cache: "no-store"')
    expect(source).not.toMatch(/localStorage|sessionStorage|Authorization|Bearer/)
  })
  it("bootstraps through fixed challenge endpoints and preserves recovery", () => {
    const source = read("components/device/device-bootstrap.tsx")
    expect(source).toContain("/api/device/session/challenge")
    expect(source).toContain("/api/device/session/complete")
    expect(source).toContain("/sign-in")
    expect(source).not.toMatch(/[?&](token|session|credential)=/i)
  })
  it("exposes enrollment from SYSTEM only to the native cockpit", () => {
    expect(read("app/(shell)/runtime/page.tsx")).toContain("<DeviceEnrollmentPanel />")
    const panel = read("components/device/device-enrollment-panel.tsx")
    expect(panel).toContain("isNativeCockpit()")
    expect(panel).toContain("operating system credential store")
  })
})
