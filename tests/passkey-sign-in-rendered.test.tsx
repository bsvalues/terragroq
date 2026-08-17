// @vitest-environment jsdom

import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const dependencies = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInPasskey: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: dependencies.push, refresh: dependencies.refresh }),
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { passkey: dependencies.signInPasskey },
  },
}))

import { PasskeySignIn } from "@/components/auth/passkey-sign-in"

beforeEach(() => {
  // jsdom has no WebAuthn: describe a machine that DOES have a built-in authenticator by default.
  ;(window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
  }
  dependencies.push.mockReset()
  dependencies.refresh.mockReset()
  dependencies.signInPasskey.mockReset().mockResolvedValue({ error: null })
})
afterEach(() => cleanup())

describe("passkey sign-in surface (issue #803)", () => {
  it("offers device sign-in and enters the cockpit when the device confirms", async () => {
    const user = userEvent.setup()
    render(<PasskeySignIn available={true} />)
    await user.click(screen.getByRole("button", { name: /sign in with this device/i }))
    await waitFor(() => expect(dependencies.push).toHaveBeenCalledWith("/"))
    expect(dependencies.refresh).toHaveBeenCalled()
  })

  it("attempts conditional autofill on mount so an existing credential can be offered inline", async () => {
    render(<PasskeySignIn available={true} />)
    await waitFor(() => expect(dependencies.signInPasskey).toHaveBeenCalledWith({ autoFill: true }))
  })

  it("treats a cancelled prompt as a choice, not a fault", async () => {
    const user = userEvent.setup()
    dependencies.signInPasskey.mockReset().mockRejectedValue(new Error("NotAllowedError: user aborted"))
    render(<PasskeySignIn available={true} />)
    await user.click(screen.getByRole("button", { name: /sign in with this device/i }))
    expect((await screen.findByRole("alert")).textContent ?? "").toMatch(/cancelled/i)
    expect(dependencies.push).not.toHaveBeenCalled()
  })

  it("explains why device sign-in is unavailable instead of showing a button that cannot work", () => {
    render(
      <PasskeySignIn
        available={false}
        unavailableReason="Passkeys cannot be bound to the IP origin 192.168.88.9. Serve WilliamOS from a hostname."
      />,
    )
    expect(screen.queryByRole("button", { name: /sign in with this device/i })).toBeNull()
    expect(screen.getByText(/cannot be bound to the IP origin/i)).toBeTruthy()
  })

  it("renders nothing at all when unavailable with no reason to give", () => {
    const { container } = render(<PasskeySignIn available={false} />)
    expect(container.textContent).toBe("")
  })

  it("does not promise a built-in unlock on a machine that has none", async () => {
    ;(window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(false),
    }
    render(<PasskeySignIn available={true} />)
    // A desktop with no fingerprint reader, no camera and no Hello PIN can only use a phone or a
    // security key, so the affordance must say that rather than offering "this device".
    expect(await screen.findByRole("button", { name: /sign in with your phone or a key/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /sign in with this device/i })).toBeNull()
  })
})
