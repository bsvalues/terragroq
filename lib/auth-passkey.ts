/**
 * WebAuthn relying-party resolution for the sovereign cockpit.
 *
 * A passkey is bound to a relying-party id (rpID), which WebAuthn requires to be a *domain*.
 * An IP-address origin such as https://192.168.88.9:3443 has no registrable domain, so a
 * credential can never be created or asserted against it. That is a property of the standard,
 * not a configuration preference, so this module fails closed and reports the reason instead of
 * letting the sign-in surface offer an authenticator that cannot work.
 *
 * Pure: no IO, no Better Auth import, so the rule is testable on its own.
 */

export type PasskeyRelyingParty = {
  readonly rpID: string
  readonly rpName: string
  readonly origin: string
}

export type PasskeyResolution =
  | { readonly available: true; readonly relyingParty: PasskeyRelyingParty }
  | { readonly available: false; readonly reason: PasskeyUnavailableReason; readonly detail: string }

export type PasskeyUnavailableReason =
  | "NO_AUTH_BASE_URL"
  | "AUTH_BASE_URL_INVALID"
  | "INSECURE_ORIGIN"
  | "IP_ADDRESS_ORIGIN"

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** Bracketed IPv6 hosts arrive from URL.hostname as "[::1]"-stripped "::1". */
function isIpAddressHost(hostname: string): boolean {
  if (IPV4.test(hostname)) return true
  return hostname.includes(":")
}

export function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}

/**
 * Resolve the relying party from the canonical auth base URL.
 *
 * Rules, in order:
 *  - the base URL must exist and parse;
 *  - the origin must be secure — https, or http on localhost, which browsers treat as a
 *    secure context for WebAuthn;
 *  - the host must be a domain. localhost is the one permitted non-registrable host because
 *    browsers special-case it; every other IP literal is refused.
 */
export function resolvePasskeyRelyingParty(
  authBaseUrl: string | null | undefined,
  { rpName = "WilliamOS" }: { rpName?: string } = {},
): PasskeyResolution {
  if (typeof authBaseUrl !== "string" || authBaseUrl.trim() === "") {
    return { available: false, reason: "NO_AUTH_BASE_URL", detail: "BETTER_AUTH_URL is not configured." }
  }
  let url: URL
  try {
    url = new URL(authBaseUrl.trim())
  } catch {
    return { available: false, reason: "AUTH_BASE_URL_INVALID", detail: "BETTER_AUTH_URL is not a valid URL." }
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhostHost(url.hostname))) {
    return {
      available: false,
      reason: "INSECURE_ORIGIN",
      detail: "Passkeys require a secure context: https, or http on localhost.",
    }
  }
  if (isIpAddressHost(url.hostname) && !isLocalhostHost(url.hostname)) {
    return {
      available: false,
      reason: "IP_ADDRESS_ORIGIN",
      detail:
        `Passkeys cannot be bound to the IP origin ${url.hostname}. ` +
        "Serve WilliamOS from a hostname (for example https://williamos.lan) and set BETTER_AUTH_URL to it.",
    }
  }
  return { available: true, relyingParty: { rpID: url.hostname, rpName, origin: url.origin } }
}

/** Human sentence for the sign-in surface when passkeys are unavailable. Never leaks config values beyond the host. */
export function passkeyUnavailableCopy(resolution: PasskeyResolution): string | null {
  return resolution.available ? null : resolution.detail
}
