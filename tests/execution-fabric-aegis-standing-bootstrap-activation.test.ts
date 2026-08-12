import crypto from "node:crypto"
import { describe, expect, it } from "vitest"

import {
  ACTIVATION_MARKER_PATH,
  validateActivationMarker,
} from "../scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs"

const HEAD_COMMIT = "a".repeat(40)
const AUTHORITY_ID = "10000000-0000-4000-8000-000000000001"
const DIGEST = "b".repeat(64)
const PREPARED_AT = "2026-08-12T18:00:00.000Z"
const CLOSURE = {
  "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs": "c".repeat(64),
  "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs": "d".repeat(64),
}

const canonical = (value: any): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)

const sha256 = (bytes: crypto.BinaryLike) => crypto.createHash("sha256").update(bytes).digest("hex")

function activationMarker() {
  return {
    schema_version: "1.0-aegis-standing-hash-activation-marker",
    upgrade_id: "aegis-standing-hash-replay-ledger-upgrade-v1",
    authority_id: AUTHORITY_ID,
    new_commit: HEAD_COMMIT,
    runtime_closure_sha256: CLOSURE,
    manifest_sha256: DIGEST,
    prepared_at: PREPARED_AT,
  }
}

function fixture(marker = activationMarker()) {
  return {
    marker,
    manifest: {
      head_commit: HEAD_COMMIT,
      file_sha256: CLOSURE,
      activation_marker_path: ACTIVATION_MARKER_PATH,
      activation_marker_sha256: sha256(Buffer.from(canonical(marker), "utf8")),
    },
  }
}

function verify(value: ReturnType<typeof fixture>) {
  return validateActivationMarker(value.manifest, Buffer.from(JSON.stringify(value.marker, null, 2), "utf8"))
}

describe("AEGIS standing hash bootstrap activation marker", () => {
  it("accepts an exact marker whose canonical digest binds the trusted release manifest", () => {
    const value = fixture()
    expect(verify(value)).toEqual(value.marker)
  })

  it.each([
    ["missing marker", () => validateActivationMarker(fixture().manifest, Buffer.alloc(0))],
    ["missing manifest digest", () => {
      const value = fixture()
      delete (value.manifest as Partial<typeof value.manifest>).activation_marker_sha256
      return verify(value)
    }],
    ["wrong manifest digest", () => {
      const value = fixture()
      value.manifest.activation_marker_sha256 = "f".repeat(64)
      return verify(value)
    }],
  ])("rejects %s", (_label, action) => {
    expect(action).toThrow(/ACTIVATION_MARKER|RELEASE_MANIFEST/)
  })

  it("rejects a marker for a different release commit", () => {
    const value = fixture({ ...activationMarker(), new_commit: "e".repeat(40) })
    expect(() => verify(value)).toThrow(/ACTIVATION_MARKER_UNTRUSTED/)
  })

  it("rejects a marker whose runtime closure is not exactly the manifest closure", () => {
    const marker = activationMarker()
    marker.runtime_closure_sha256 = { ...CLOSURE, unexpected: "f".repeat(64) }
    const value = fixture(marker)
    expect(() => verify(value)).toThrow(/ACTIVATION_MARKER_UNTRUSTED/)
  })

  it.each([
    ["schema", { schema_version: "1.0-wrong" }],
    ["upgrade", { upgrade_id: "different-upgrade" }],
    ["authority UUID", { authority_id: "not-a-uuid" }],
    ["manifest digest", { manifest_sha256: "ABC" }],
    ["canonical timestamp", { prepared_at: "2026-08-12T18:00:00Z" }],
  ])("rejects invalid %s metadata", (_label, mutation) => {
    const value = fixture({ ...activationMarker(), ...mutation })
    expect(() => verify(value)).toThrow(/ACTIVATION_MARKER_UNTRUSTED/)
  })

  it.each([
    ["malformed JSON", Buffer.from("{", "utf8")],
    ["an unexpected field", Buffer.from(JSON.stringify({ ...activationMarker(), extra: true }), "utf8")],
    ["a missing field", Buffer.from(JSON.stringify((({ prepared_at: _removed, ...marker }) => marker)(activationMarker())), "utf8")],
  ])("rejects %s", (_label, bytes) => {
    const value = fixture()
    expect(() => validateActivationMarker(value.manifest, bytes)).toThrow(/ACTIVATION_MARKER_UNTRUSTED/)
  })
})
