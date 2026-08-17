/**
 * Device onboarding payloads.
 *
 * Adding a phone to WilliamOS must not become a set of instructions the owner performs by hand
 * (mail yourself a .cer, open Settings, find Certificate Trust Settings…). The product serves the
 * trust anchor as a payload the device already knows how to install, and the UI walks the two taps
 * Apple genuinely requires. This module is the pure part: PEM parsing and profile construction, so
 * it can be tested without a request, a filesystem, or a device.
 */

export type TrustProfileInput = {
  /** PEM-encoded root CA certificate (the trust anchor the HTTPS leaf chains to). */
  readonly certificatePem: string
  /** Human name shown on the device while installing. */
  readonly displayName: string
  /** Reverse-DNS profile identifier, e.g. "lan.williamos.trust". */
  readonly identifier: string
  /** Stable UUIDs so re-installing updates the same profile instead of stacking duplicates. */
  readonly profileUuid: string
  readonly payloadUuid: string
  /** Origin the profile exists to make trusted, shown to the owner as the reason. */
  readonly origin: string
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g

/** Base64 DER bodies of every certificate in a PEM bundle, in order. */
export function certificateBodies(certificatePem: string): string[] {
  if (typeof certificatePem !== "string") return []
  const bodies: string[] = []
  for (const match of certificatePem.matchAll(PEM_BLOCK)) {
    const body = match[1].replace(/\s+/g, "")
    if (body.length > 0 && /^[A-Za-z0-9+/=]+$/.test(body)) bodies.push(body)
  }
  return bodies
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
}

/** Wrap base64 at 64 columns, as certificate payloads are conventionally written. */
function wrap(body: string): string {
  return (body.match(/.{1,64}/g) ?? []).join("\n")
}

/**
 * An Apple configuration profile carrying the root CA. Installing it makes the cockpit's HTTPS
 * certificate valid on the device, which is a precondition for passkeys: WebAuthn refuses to run
 * in a context the browser does not consider secure.
 *
 * Throws when the PEM contains no certificate, rather than emitting an empty profile that would
 * install cleanly and trust nothing.
 */
export function buildAppleTrustProfile(input: TrustProfileInput): string {
  const bodies = certificateBodies(input.certificatePem)
  if (bodies.length === 0) throw new Error("TRUST_PROFILE_NO_CERTIFICATE")
  const name = escapeXml(input.displayName)
  const description = escapeXml(`Lets this device trust ${input.origin}. Contains a public certificate only; no keys or credentials.`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>PayloadType</key><string>Configuration</string>",
    "  <key>PayloadVersion</key><integer>1</integer>",
    `  <key>PayloadIdentifier</key><string>${escapeXml(input.identifier)}</string>`,
    `  <key>PayloadUUID</key><string>${escapeXml(input.profileUuid)}</string>`,
    `  <key>PayloadDisplayName</key><string>${name}</string>`,
    `  <key>PayloadDescription</key><string>${description}</string>`,
    "  <key>PayloadOrganization</key><string>WilliamOS</string>",
    "  <key>PayloadRemovalDisallowed</key><false/>",
    "  <key>PayloadContent</key>",
    "  <array>",
    ...bodies.flatMap((body, index) => [
      "    <dict>",
      "      <key>PayloadType</key><string>com.apple.security.root</string>",
      "      <key>PayloadVersion</key><integer>1</integer>",
      `      <key>PayloadIdentifier</key><string>${escapeXml(`${input.identifier}.cert.${index}`)}</string>`,
      `      <key>PayloadUUID</key><string>${escapeXml(index === 0 ? input.payloadUuid : `${input.payloadUuid}-${index}`)}</string>`,
      `      <key>PayloadDisplayName</key><string>${name} certificate</string>`,
      "      <key>PayloadCertificateFileName</key><string>williamos-root-ca.cer</string>",
      "      <key>PayloadContent</key>",
      `      <data>${wrap(body)}</data>`,
      "    </dict>",
    ]),
    "  </array>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}

/** The steps a device genuinely requires, in order, so the UI can show them one at a time. */
export function onboardingSteps(platform: "apple" | "other", origin: string): readonly string[] {
  if (platform === "apple") {
    return [
      "Tap Install trust profile, then Allow when your device asks to download it.",
      "Open Settings. A Profile Downloaded item appears near the top — tap it and Install.",
      "Go to Settings, General, About, Certificate Trust Settings, and turn on WilliamOS.",
      `Return here at ${origin} and tap Add this device to finish with Face ID or Touch ID.`,
    ]
  }
  return [
    "Install the trust certificate when your device offers it.",
    `Open ${origin} on this device.`,
    "Tap Add this device and confirm with your fingerprint, face, or screen lock.",
  ]
}

export type IdentityProfileInput = TrustProfileInput & {
  /** Base64 PKCS#12 bundle holding the device key and certificate. */
  readonly identityP12Base64: string
  /** Password iOS uses to open that bundle while installing. */
  readonly identityPassword: string
  readonly identityName: string
  readonly identityUuid: string
}

/**
 * One profile that both trusts the cockpit and gives this device its own identity.
 *
 * Unlike the trust profile this contains a PRIVATE KEY, so it must never be served openly: anyone
 * who installs it can open the cockpit. The route gates it behind a one-time code minted on a
 * device that is already signed in, which is the same proof used to link a device.
 */
export function buildAppleIdentityProfile(input: IdentityProfileInput): string {
  const bodies = certificateBodies(input.certificatePem)
  if (bodies.length === 0) throw new Error("TRUST_PROFILE_NO_CERTIFICATE")
  if (!input.identityP12Base64 || !/^[A-Za-z0-9+/=\s]+$/.test(input.identityP12Base64)) throw new Error("IDENTITY_PROFILE_NO_BUNDLE")
  const name = escapeXml(input.displayName)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>PayloadType</key><string>Configuration</string>",
    "  <key>PayloadVersion</key><integer>1</integer>",
    `  <key>PayloadIdentifier</key><string>${escapeXml(input.identifier)}</string>`,
    `  <key>PayloadUUID</key><string>${escapeXml(input.profileUuid)}</string>`,
    `  <key>PayloadDisplayName</key><string>${name}</string>`,
    `  <key>PayloadDescription</key><string>${escapeXml(`Trusts ${input.origin} and signs this device in without a password.`)}</string>`,
    "  <key>PayloadOrganization</key><string>WilliamOS</string>",
    "  <key>PayloadRemovalDisallowed</key><false/>",
    "  <key>PayloadContent</key>",
    "  <array>",
    ...bodies.flatMap((body, index) => [
      "    <dict>",
      "      <key>PayloadType</key><string>com.apple.security.root</string>",
      "      <key>PayloadVersion</key><integer>1</integer>",
      `      <key>PayloadIdentifier</key><string>${escapeXml(`${input.identifier}.cert.${index}`)}</string>`,
      `      <key>PayloadUUID</key><string>${escapeXml(index === 0 ? input.payloadUuid : `${input.payloadUuid}-${index}`)}</string>`,
      `      <key>PayloadDisplayName</key><string>${name} certificate</string>`,
      "      <key>PayloadCertificateFileName</key><string>williamos-root-ca.cer</string>",
      "      <key>PayloadContent</key>",
      `      <data>${wrap(body)}</data>`,
      "    </dict>",
    ]),
    "    <dict>",
    "      <key>PayloadType</key><string>com.apple.security.pkcs12</string>",
    "      <key>PayloadVersion</key><integer>1</integer>",
    `      <key>PayloadIdentifier</key><string>${escapeXml(`${input.identifier}.identity`)}</string>`,
    `      <key>PayloadUUID</key><string>${escapeXml(input.identityUuid)}</string>`,
    `      <key>PayloadDisplayName</key><string>${escapeXml(input.identityName)}</string>`,
    "      <key>PayloadCertificateFileName</key><string>williamos-device.p12</string>",
    `      <key>Password</key><string>${escapeXml(input.identityPassword)}</string>`,
    "      <key>PayloadContent</key>",
    `      <data>${wrap(input.identityP12Base64.replace(/\s+/g, ""))}</data>`,
    "    </dict>",
    "  </array>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}
