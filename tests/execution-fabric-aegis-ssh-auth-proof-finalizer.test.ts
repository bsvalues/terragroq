import { describe, expect, it } from "vitest"
import { buildAuthProof, canonicalize } from "../scripts/execution-fabric/provision/finalize-aegis-ssh-coexistence-auth-proof.mjs"

const authorityId = "6ee16e97-56ca-4e70-9e93-370ff310a46b"
const challengeIssuedAt = "2026-08-12T16:40:18.391Z"
const journalBytes = Buffer.from([
  canonicalize({ record_type: "AUTHORITY_CONSUMED", authority_id: authorityId }),
  canonicalize({ record_type: "MUTATED_AWAITING_AUTH_PROBE" }),
  canonicalize({ record_type: "AUTH_PROBE_CHALLENGE_ISSUED", challenge_nonce: "4b".repeat(32), challenge_issued_at: challengeIssuedAt }),
  canonicalize({ record_type: "LOCK_RELEASE_PROVEN_AWAITING_AUTH_PROBE" }),
].join("\n") + "\n")
const exactEvent = { MESSAGE: "Accepted publickey for williamos-fabric from 192.168.88.9 port 52018 ssh2: ED25519 SHA256:dlhYn3gjgDUQ09vFt583lXl2JKMhyFQMVoFE0sQpa48", __REALTIME_TIMESTAMP: String(Date.parse("2026-08-12T16:40:59.000Z") * 1000), _UID: "0", _GID: "0", _COMM: "sshd", _EXE: "/usr/sbin/sshd", _SYSTEMD_UNIT: "ssh.service", _TRANSPORT: "syslog", SYSLOG_IDENTIFIER: "sshd", _HOSTNAME: "aegis", _MACHINE_ID: "965def1e302b4ff8a3cb5fefa7458bc4" }

describe("AEGIS SSH coexistence authentication proof finalizer", () => {
  it("builds the exact challenge-bound proof from one fresh sshd event", () => {
    expect(buildAuthProof({ authorityId, journalBytes, journalEvents: [exactEvent], now: "2026-08-12T16:41:00.000Z" })).toMatchObject({ authorityId, challengeIssuedAt, result: "STANDING_AUTHENTICATED", sourceAddress: "192.168.88.9", authenticatedAt: "2026-08-12T16:40:59.000Z" })
  })
  it.each([
    ["wrong source", { ...exactEvent, MESSAGE: exactEvent.MESSAGE.replace("192.168.88.9", "192.168.88.10") }],
    ["wrong key", { ...exactEvent, MESSAGE: exactEvent.MESSAGE.replace("dlhYn3", "badKey0") }],
    ["wrong user", { ...exactEvent, MESSAGE: exactEvent.MESSAGE.replace("williamos-fabric", "bs") }],
    ["pre-challenge", { ...exactEvent, __REALTIME_TIMESTAMP: String(Date.parse("2026-08-12T16:40:17.000Z") * 1000) }],
  ])("rejects %s authentication evidence", (_label, event) => {
    expect(() => buildAuthProof({ authorityId, journalBytes, journalEvents: [event], now: "2026-08-12T16:41:00.000Z" })).toThrow("AEGIS_SSH_AUTH_PROOF_EVENT_INVALID")
  })
  it("rejects ambiguous matching events", () => expect(() => buildAuthProof({ authorityId, journalBytes, journalEvents: [exactEvent, exactEvent], now: "2026-08-12T16:41:00.000Z" })).toThrow("AEGIS_SSH_AUTH_PROOF_EVENT_INVALID"))
  it("rejects a stale challenge", () => expect(() => buildAuthProof({ authorityId, journalBytes, journalEvents: [exactEvent], now: "2026-08-12T16:56:00.000Z" })).toThrow("AEGIS_SSH_AUTH_PROOF_EVENT_INVALID"))
  it("rejects untrusted sshd provenance", () => expect(() => buildAuthProof({ authorityId, journalBytes, journalEvents: [{ ...exactEvent, _UID: "999" }], now: "2026-08-12T16:41:00.000Z" })).toThrow("AEGIS_SSH_AUTH_PROOF_EVENT_INVALID"))
  it("rejects a reordered repair journal", () => { const lines = journalBytes.toString("utf8").trim().split("\n"); expect(() => buildAuthProof({ authorityId, journalBytes: Buffer.from([lines[0], lines[2], lines[1], lines[3]].join("\n") + "\n"), journalEvents: [exactEvent], now: "2026-08-12T16:41:00.000Z" })).toThrow("AEGIS_SSH_AUTH_PROOF_JOURNAL_INVALID") })
  it("emits canonical key ordering", () => expect(canonicalize({ z: 1, a: 2 })).toBe('{"a":2,"z":1}'))
})
