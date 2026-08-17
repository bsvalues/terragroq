import { betterAuth } from "better-auth"
import { emailOTP } from "better-auth/plugins/email-otp"
import { passkey } from "@better-auth/passkey"
import { pool } from "@/lib/db"
import { createEmailOtpOptions } from "@/lib/auth-email-otp"
import { resolveAuthBaseUrl, resolveTrustedOriginConfig } from "@/lib/auth-origins"
import { resolvePasskeyRelyingParty } from "@/lib/auth-passkey"

const trustedOriginConfig = resolveTrustedOriginConfig()
// Passkeys are only offered when the canonical origin can actually carry them: WebAuthn binds a
// credential to a domain, so an IP origin is refused rather than advertised and then failing.
export const passkeyResolution = resolvePasskeyRelyingParty(resolveAuthBaseUrl())

export const auth = betterAuth({
  database: pool,
  baseURL: resolveAuthBaseUrl(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  trustedOrigins: trustedOriginConfig.trustedOrigins,
  plugins: [
    emailOTP(createEmailOtpOptions()),
    ...(passkeyResolution.available
      ? [passkey({
          rpID: passkeyResolution.relyingParty.rpID,
          rpName: passkeyResolution.relyingParty.rpName,
          origin: passkeyResolution.relyingParty.origin,
          // Ask for the authenticator built into the device in front of the operator: Windows Hello
          // here, Face ID on the phone. Without this the browser offers its whole provider list --
          // phone-by-QR, USB key, password managers -- and on Windows 10 the QR path cannot work at
          // all, so the owner is left choosing between options that dead-end.
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "preferred",
          },
        })]
      : []),
  ],
  session: {
    // A single-operator cockpit on the owner's own LAN should not re-interrogate him every week.
    // The session is bound to this device's cookie jar behind an HTTPS boundary that only answers
    // on the private network, and it rolls forward on use, so an active operator is never asked
    // again. Ninety days is the outer bound for a device left untouched.
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  ...(process.env.NODE_ENV === "development"
    ? {
        advanced: {
          // The v0 preview renders the app inside a cross-site iframe. Browsers
          // block ordinary third-party cookies there, which silently drops the
          // session cookie and bounces every sign-in/sign-up back to /sign-in.
          // SameSite=None + Secure + Partitioned (CHIPS) lets the cookie be
          // stored in the partitioned (per-top-site) jar, so auth works in the
          // iframe even with third-party cookies disabled.
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
            partitioned: true,
          },
        },
      }
    : {}),
})
