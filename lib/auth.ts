import { betterAuth } from "better-auth"
import { pool } from "@/lib/db"
import { resolveAuthBaseUrl, resolveTrustedOriginConfig } from "@/lib/auth-origins"

const trustedOriginConfig = resolveTrustedOriginConfig()

export const auth = betterAuth({
  database: pool,
  baseURL: resolveAuthBaseUrl(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  trustedOrigins: trustedOriginConfig.trustedOrigins,
  session: {
    expiresIn: 60 * 60 * 24 * 7,
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
