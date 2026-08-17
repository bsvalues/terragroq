import { passkeyResolution } from "@/lib/auth"
import { onboardingSteps } from "@/lib/device-onboarding"
import { IdentityProfileForm } from "@/components/auth/identity-profile-form"

export const dynamic = "force-dynamic"

/**
 * The page a new device opens first, before it can sign in.
 *
 * It is deliberately unauthenticated and deliberately plain: a device that does not yet trust the
 * cockpit's certificate cannot hold a session, and on iOS it cannot run WebAuthn either, so this
 * has to work on an untrusted connection with nothing but a link and instructions.
 */
export default function TrustPage() {
  const origin = passkeyResolution.available ? passkeyResolution.relyingParty.origin : "this cockpit"
  const steps = onboardingSteps("apple", origin)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Trust this cockpit</h1>
        <p className="text-sm text-muted-foreground">
          Your device does not know WilliamOS yet, so it shows a security warning. Installing this
          certificate fixes that permanently. It is a public certificate — it contains no keys, no
          passwords, and nothing that can sign in as you.
        </p>
      </header>

      <a
        href="/api/device-onboarding/trust-profile"
        className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-primary-foreground"
      >
        Install trust profile
      </a>

      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm">
            <span
              aria-hidden
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border text-[10px] font-medium"
            >
              {index + 1}
            </span>
            <span className="leading-6">{step}</span>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-sm font-medium">Skip the password on this device</h2>
        <p className="text-xs text-muted-foreground">
          Install an identity for this device and WilliamOS will recognise it automatically. It
          carries a private key, so it is only issued against a one-time code from a device you are
          already signed in on.
        </p>
        <IdentityProfileForm />
      </section>

      <p className="text-xs text-muted-foreground">
        Not an Apple device? Open{" "}
        <span className="font-mono">/api/device-onboarding/trust-profile</span> and install the
        certificate the way your system offers, then return to {origin}.
      </p>
    </main>
  )
}
