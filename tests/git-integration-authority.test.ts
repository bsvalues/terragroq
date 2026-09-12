import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The lab integration authority is only an improvement over the gate it replaces if it REFUSES
 * what the gate refused. These run the real CLI against the sealed #1218 head with --verify-only
 * (never side effects) using fixtures that are public artifacts (the seal block was pasted into
 * the PR body; the attestation is the review signature). Every mutation must exit 1 with
 * INTEGRATION_REFUSED and the specific typed reason. The negative tests do not require the seal
 * KEY: the structure/head/paths checks run before any signature verification.
 */

const SEALED_HEAD = "84576f8d63b0ffa09a34a1a0663a62b8fc7d31a7"
const SEALED_BASE = "29e9b729741bfbd5d9c69e24dd3066a8a668c1e5"
const FIXTURE_SEAL = path.resolve("tests/fixtures/sealed-1218.json")
const FIXTURE_ATTESTATION = path.resolve("tests/fixtures/attestation-1218.json")
const RUNTIME_ENV = "C:/HermesLab/williamos-runtime-64034e93-flat/.env.local"

function artifact(name: string, mutate: (value: any) => void): string {
  const source = name === "seal" ? FIXTURE_SEAL : FIXTURE_ATTESTATION
  const value = JSON.parse(fs.readFileSync(source, "utf8"))
  mutate(value)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-authority-"))
  const file = path.join(dir, `${name}.json`)
  fs.writeFileSync(file, JSON.stringify(value))
  return file
}

function run(args: string[], extraEnv: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(process.execPath,
      ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.resolve("scripts/execution-fabric/integrate-lab-main.mjs"), ...args],
      { encoding: "utf8", timeout: 180_000, env: { ...process.env, ...extraEnv } })
    return { code: 0, output: stdout }
  } catch (error: any) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` }
  }
}

const fixturesPresent = fs.existsSync(FIXTURE_SEAL) && fs.existsSync(FIXTURE_ATTESTATION)

describe.skipIf(!fixturesPresent)("lab integration authority", () => {
  it("refuses a candidate that is not the sealed head", () => {
    const result = run([
      `--cand=${SEALED_BASE}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${FIXTURE_ATTESTATION}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    expect(result.output).toContain("SEAL_HEAD_MISMATCH")
  }, 240_000)

  it("refuses a seal whose declared paths do not cover the change", () => {
    const file = artifact("seal", (value) => {
      value.sealBlock = value.sealBlock.replace(/"paths": \[[\s\S]*?\]/, '"paths": []')
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${file}`, `--attestation=${FIXTURE_ATTESTATION}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    expect(result.output).toContain("INTEGRATION_REFUSED")
  }, 240_000)

  it("refuses a tampered seal payload: the signature binds the exact head", () => {
    const file = artifact("seal", (value) => {
      value.sealBlock = value.sealBlock.replace(SEALED_HEAD, SEALED_BASE)
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${file}`, `--attestation=${FIXTURE_ATTESTATION}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    // Machine-with-key refuses at the head check or the signature check; a machine without the
    // lab key refuses earlier at the trust root — typed INTEGRATION_REFUSED either way, never
    // acceptance and never a raw crash. Exact crypto discrimination is asserted in the
    // key-material block below.
    expect(result.output).toMatch(/SEAL_HEAD_MISMATCH|SEAL_SIGNATURE_INVALID|SEAL_KEY_UNAVAILABLE/)
  }, 240_000)

  it("refuses an attestation whose verdict is not CLEAN for this exact head", () => {
    const file = artifact("attestation", (value) => {
      value.payload.verdict = "BLOCKING_FINDINGS"
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${file}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    expect(result.output).toContain("REVIEW_NOT_ACCEPTED")
  }, 240_000)

  it("refuses a corrupted attestation signature", () => {
    const file = artifact("attestation", (value) => {
      value.signature = "AA" + value.signature.slice(2)
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${file}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    // Keyless machines cannot reach the ring check; the trust root refuses first. The exact
    // signature-vs-ring refusal is asserted in the key-material block below.
    expect(result.output).toMatch(/REVIEW_NOT_ACCEPTED|SEAL_KEY_UNAVAILABLE|REVIEWER_RING_UNAVAILABLE/)
  }, 240_000)

  it("refuses an attestation bound to a different head", () => {
    const file = artifact("attestation", (value) => {
      value.payload.reviewedHeadSha = SEALED_BASE
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${file}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    // Either guard may refuse this input: the adoption-bind check (ATTESTATION_NOT_ADOPTION_REVIEW,
    // added after independent review) fires before the candidate-head check on this fixture.
    expect(result.output).toMatch(/ATTESTATION_NOT_ADOPTION_REVIEW|REVIEW_NOT_ACCEPTED/)
  }, 240_000)
})

describe.skipIf(!fs.existsSync(RUNTIME_ENV))("lab integration authority (key material present)", () => {
  it("accepts the exact sealed head when everything matches (positive control, lab machine only)", () => {
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${FIXTURE_ATTESTATION}`, "--verify-only",
    ])
    expect(result.output).toContain("VERIFICATION_OK")
  }, 240_000)

  it("with real trust roots, a seal whose signed bytes differ is refused at the crypto layer", () => {
    // The first SHA occurrence in the block is adoption.evidence.validationHeadSha, which no
    // structural guard reads: the tampered seal must fall to signature verification, proving the
    // signature (not a field check) is what binds every signed byte.
    const file = artifact("seal", (value) => {
      value.sealBlock = value.sealBlock.replace(SEALED_HEAD, SEALED_BASE)
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${file}`, `--attestation=${FIXTURE_ATTESTATION}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    expect(result.output).toContain("SEAL_SIGNATURE_INVALID")
  }, 240_000)

  it("with the real reviewer ring, a corrupted attestation signature is refused for the signature itself", () => {
    const file = artifact("attestation", (value) => {
      value.signature = "AA" + value.signature.slice(2)
    })
    const result = run([
      `--cand=${SEALED_HEAD}`, `--base=${SEALED_BASE}`,
      `--seal=${FIXTURE_SEAL}`, `--attestation=${file}`, "--verify-only",
    ])
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/REVIEW_NOT_ACCEPTED.*"reason":"signature"|reason.*signature/)
  }, 240_000)
})
