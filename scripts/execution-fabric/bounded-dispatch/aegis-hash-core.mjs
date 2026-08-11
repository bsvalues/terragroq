import crypto from "node:crypto"

const SHA256 = /^[a-f0-9]{64}$/
const MAX_BYTES = 1048576

export class AegisHashCoreError extends Error {
  constructor(code, detail) {
    super(detail)
    this.name = "AegisHashCoreError"
    this.code = code
  }
}

const fail = (code, detail) => { throw new AegisHashCoreError(code, detail) }

export function verifyAegisHashBytes(bytes, expectedSha256, expectedByteLength) {
  if (!(bytes instanceof Uint8Array)) fail("INPUT_INVALID", "HASH_VERIFY input must be exact bytes")
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0 || expectedByteLength > MAX_BYTES) {
    fail("BYTE_CEILING_EXCEEDED", "HASH_VERIFY expected byte length exceeds the reviewed ceiling")
  }
  if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) {
    fail("INPUT_INVALID", "HASH_VERIFY expected digest must be lowercase SHA-256")
  }
  const exactBytes = Buffer.from(bytes)
  if (exactBytes.byteLength !== expectedByteLength) fail("INPUT_CHANGED", "HASH_VERIFY byte length does not match")
  const observedSha256 = crypto.createHash("sha256").update(exactBytes).digest("hex")
  return Object.freeze({
    byte_length: exactBytes.byteLength,
    expected_sha256: expectedSha256,
    observed_sha256: observedSha256,
    matched: observedSha256 === expectedSha256,
  })
}
