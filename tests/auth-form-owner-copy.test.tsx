// @vitest-environment jsdom

import React from "react"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const dependencies = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: dependencies.push, refresh: dependencies.refresh }),
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}))

import { AuthForm, type AuthReadinessState } from "@/components/auth-form"

/**
 * GOAL-0018. This is a single-owner system: the sign-in page must speak to the owner instead of
 * narrating provisioning state, environment-flag names, or a placeholder borrowed from another
 * product. Copy is all that may change — the suppression must stay targeted, so a genuine blocking
 * issue still reaches the page and still blocks submit.
 */

/** Auth is ready; owner provisioning is locked because the Primary Operator already exists. */
const readyProvisioningLocked: AuthReadinessState = {
  ready: true,
  issues: [],
  signup: {
    mode: "bootstrap",
    open: false,
    reason: "Owner provisioning is not available. Contact the Primary Operator.",
  },
  emailOtp: {
    enabled: false,
    configured: false,
    provider: "resend",
    reason: "Email OTP is scaffolded but disabled until AUTH_EMAIL_OTP_ENABLED=true.",
  },
}

afterEach(() => cleanup())

describe("sign-in copy speaks to the owner (GOAL-0018)", () => {
  it("does not narrate provisioning-lock status at the owner", () => {
    const { container } = render(<AuthForm mode="sign-in" readiness={readyProvisioningLocked} />)

    expect(container.textContent ?? "").not.toMatch(/owner provisioning is (locked|disabled)/i)
    expect(screen.getByText("Welcome back.")).toBeTruthy()
  })

  it("does not narrate policy-closed provisioning either", () => {
    const { container } = render(
      <AuthForm
        mode="sign-in"
        readiness={{
          ...readyProvisioningLocked,
          signup: {
            mode: "closed",
            open: false,
            reason: "Owner provisioning is disabled by policy.",
          },
        }}
      />,
    )

    expect(container.textContent ?? "").not.toMatch(/owner provisioning is (locked|disabled)/i)
  })

  it("never shows the AUTH_EMAIL_OTP_ENABLED note in the recovery copy", () => {
    const { container } = render(<AuthForm mode="sign-in" readiness={readyProvisioningLocked} />)

    expect(container.textContent ?? "").not.toContain("AUTH_EMAIL_OTP_ENABLED")
    expect(container.textContent ?? "").not.toMatch(/scaffolded/i)
    expect(screen.getByText(/email recovery isn't available yet/i)).toBeTruthy()
  })

  it("never shows the AUTH_EMAIL_OTP_ENABLED note when it arrives as a readiness warning", () => {
    const { container } = render(
      <AuthForm
        mode="sign-in"
        readiness={{
          ...readyProvisioningLocked,
          issues: [
            {
              code: "EMAIL_OTP_DISABLED",
              severity: "warning",
              message: "Email OTP is scaffolded but disabled until AUTH_EMAIL_OTP_ENABLED=true.",
            },
          ],
        }}
      />,
    )

    expect(container.textContent ?? "").not.toContain("AUTH_EMAIL_OTP_ENABLED")
  })

  it("uses a neutral email placeholder rather than a borrowed brand address", () => {
    render(<AuthForm mode="sign-in" readiness={readyProvisioningLocked} />)

    const email = screen.getByLabelText("Email") as HTMLInputElement
    expect(email.placeholder).toBe("name@example.com")
    expect(email.placeholder).not.toContain("command.io")
  })

  it("still renders genuine blocking issues and still refuses submit", () => {
    render(
      <AuthForm
        mode="sign-in"
        readiness={{
          ready: false,
          issues: [
            {
              code: "DATABASE_URL_MISSING",
              severity: "error",
              message: "DATABASE_URL is not configured.",
            },
            {
              code: "AUTH_BASE_URL_MISSING",
              severity: "warning",
              message: "Auth base URL is not configured and callbacks may be unreliable.",
            },
          ],
        }}
      />,
    )

    expect(screen.getByText("DATABASE_URL is not configured.")).toBeTruthy()
    expect(
      screen.getByText("Auth base URL is not configured and callbacks may be unreliable."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: /authentication blocked/i })).toHaveProperty(
      "disabled",
      true,
    )
  })
})
