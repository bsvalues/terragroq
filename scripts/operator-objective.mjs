import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const crypto = await import("node:crypto")
const fs = await import("node:fs")
const path = await import("node:path")
const os = await import("node:os")
const { buildDeviceProof, DEVICE_AUTH_HEADER } = await import("@/lib/device-auth/contract")

/**
 * The commissioning driver's client: authenticate as the synthetic operator, submit an objective.
 *
 * This is deliberately thin. It is not an agent framework and not a shell -- it does exactly what a
 * human operator's browser does, using the device-session routes that already existed before #872.
 * The whole point of #871 is that the frontier agent stays in the operator chair, so this must never
 * grow the ability to do anything WilliamOS itself cannot do.
 */
const BASE = process.env.WILLIAMOS_OPERATOR_ORIGIN ?? "https://192.168.88.9:3443"
const KEY_FILE = path.join(os.homedir(), ".williamos", "operator", "synthetic-operator.ed25519")
const CREDENTIAL_ID = process.env.WILLIAMOS_OPERATOR_CREDENTIAL_ID
const objective = process.argv.slice(2).join(" ").trim()

if (!CREDENTIAL_ID) throw new Error("WILLIAMOS_OPERATOR_CREDENTIAL_ID is required")
if (!objective) throw new Error("an objective is required")

// TLS trust comes from NODE_EXTRA_CA_CERTS (set from WILLIAMOS_ROOT_CA_PATH by the caller), so this
// verifies the proxy properly instead of disabling certificate checking.
if (!process.env.NODE_EXTRA_CA_CERTS) {
  console.warn("warning: NODE_EXTRA_CA_CERTS is unset; TLS verification may fail against the lab CA")
}
const call = (url, body, cookie) =>
  fetch(url, {
    method: "POST",
    // The device routes require an Origin they trust and an explicit device-auth header; both are
    // part of the contract a browser satisfies automatically, and a non-browser client must too.
    headers: {
      "content-type": "application/json",
      origin: BASE,
      [DEVICE_AUTH_HEADER]: "1",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })

const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_FILE))

const challengeResponse = await call(`${BASE}/api/device/session/challenge`, { credentialId: CREDENTIAL_ID })
const challenge = await challengeResponse.json()
if (!challengeResponse.ok) throw new Error(`challenge failed ${challengeResponse.status}: ${JSON.stringify(challenge)}`)

const proof = buildDeviceProof({
  purpose: "authenticate",
  challengeId: challenge.challengeId,
  challenge: challenge.challenge,
  origin: BASE,
  expiresAt: challenge.expiresAt,
})
const signature = crypto.sign(null, Buffer.from(proof), privateKey).toString("base64url")

const completed = await call(`${BASE}/api/device/session/complete`, {
  challengeId: challenge.challengeId,
  challenge: challenge.challenge,
  signature,
})
const completedBody = await completed.json()
if (!completed.ok) throw new Error(`authentication failed ${completed.status}: ${JSON.stringify(completedBody)}`)

const setCookie = completed.headers.getSetCookie?.() ?? []
const sessionCookie = setCookie.map((c) => c.split(";")[0]).join("; ")
console.log(`authenticated as the synthetic operator; session expires ${completedBody.expiresAt}`)

// #874: objectives are submitted to the intake seam, which admits them as work. The old /api/intent
// call is kept below so a run records BOTH what intake did and what the classifier still does.
const admitted = await call(`${BASE}/api/objective`, { objective }, sessionCookie)
const admission = await admitted.text()
console.log(`POST /api/objective -> HTTP ${admitted.status}`)
console.log(admission.slice(0, 400))

// #876: with an objective admitted, ask WilliamOS what the objective is ABOUT.
const resolved = await fetch(`${BASE}/api/resource?identity=PACS`, { headers: { cookie: sessionCookie } })
const record = await resolved.text()
console.log(`GET  /api/resource?identity=PACS -> HTTP ${resolved.status}`)
console.log(record.slice(0, 700))

// #878: with the record resolved, ask whether it agrees with what we already recorded.
const reconciled = await call(`${BASE}/api/resource/reconcile`, { identity: "PACS" }, sessionCookie)
const verdict = await reconciled.text()
console.log(`POST /api/resource/reconcile     -> HTTP ${reconciled.status}`)
console.log(verdict.slice(0, 700))

