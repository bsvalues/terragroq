import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { authenticateCockpit } from "../components/device/device-bootstrap"

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
  it("converts a proxy-verified TLS device into the existing owner session before native recovery", () => {
    const source = read("app/device-bootstrap/page.tsx")
    const header = source.indexOf('get("x-williamos-device-cert")')
    const certificateSession = source.indexOf('redirect("/api/device-cert/session?next=/")')
    const nativeBootstrap = source.indexOf("return <DeviceBootstrap />")
    expect(header).toBeGreaterThan(-1)
    expect(certificateSession).toBeGreaterThan(header)
    expect(nativeBootstrap).toBeGreaterThan(certificateSession)
  })
  it("routes an authenticated credential-less Cockpit to explicit enrollment", async () => {
    const replace = vi.fn()
    await authenticateCockpit({
      getCredential: async () => null,
      getSession: async () => ({ data: { user: { id: "primary" } } }),
      requestChallenge: vi.fn(), sign: vi.fn(), complete: vi.fn(), replace,
    })
    expect(replace).toHaveBeenCalledWith("/runtime?detail=technical")
  })
  it("routes an unauthenticated credential-less Cockpit to recovery sign-in", async () => {
    const replace = vi.fn()
    await authenticateCockpit({
      getCredential: async () => null,
      getSession: async () => ({ data: null }),
      requestChallenge: vi.fn(), sign: vi.fn(), complete: vi.fn(), replace,
    })
    expect(replace).toHaveBeenCalledWith("/sign-in")
  })
  it("keeps credential challenge, sign, and completion behavior intact", async () => {
    const calls: string[] = []
    const complete = vi.fn(async () => { calls.push("complete") })
    const replace = vi.fn()
    await authenticateCockpit({
      getCredential: async () => ({ credentialId: "credential-1" }),
      getSession: vi.fn(),
      requestChallenge: async (credentialId) => { calls.push(`challenge:${credentialId}`); return { challengeId: "challenge-1", challenge: "nonce", proof: "proof" } },
      sign: async (proof) => { calls.push(`sign:${proof}`); return { signature: "signature" } },
      complete,
      replace,
    })
    expect(calls).toEqual(["challenge:credential-1", "sign:proof", "complete"])
    expect(complete).toHaveBeenCalledWith({ challengeId: "challenge-1", challenge: "nonce", signature: "signature" })
    expect(replace).toHaveBeenCalledWith("/")
  })
  it("exposes enrollment from SYSTEM only to the native cockpit", () => {
    expect(read("app/(shell)/runtime/page.tsx")).toContain("<DeviceEnrollmentPanel />")
    const panel = read("components/device/device-enrollment-panel.tsx")
    expect(panel).toContain("isNativeCockpit()")
    expect(panel).toContain("operating system credential store")
  })
})
