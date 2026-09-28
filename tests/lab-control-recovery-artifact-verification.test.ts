import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The off-host restore readback publishes a receipt the Console reports as proven recovery. It
 * downloaded and hashed only the proof and appliance-config archives, while the manifest it consumed
 * also recorded the PostgreSQL / Redis / Open WebUI / Portainer volume archives -- the data recovery
 * actually restores. A generation whose replica volumes were missing or corrupt could therefore still
 * publish PASS. These assertions keep the whole artifact set in the certification path; the behaviour
 * behind them is exercised in tests/lab-control/recovery-artifact-verification.Tests.ps1.
 */
const read = (p: string) => readFileSync(p, "utf8")

describe("off-host restore artifact certification", () => {
  const verifier = read("scripts/lab-control/hermes/verify-offhost-restore.ps1")
  const lib = read("scripts/lab-control/hermes/crossnode-sync-lib.ps1")

  it("certifies every artifact the manifest records, not only the downloaded ones", () => {
    expect(verifier).toContain("Assert-ManifestRecoveryArtifacts")
    expect(lib).toContain("function Assert-ManifestRecoveryArtifacts")
    // It must iterate the manifest's own artifact set rather than a hard-coded pair.
    expect(lib).toMatch(/\$Manifest\.artifacts/)
    // Presence alone is not integrity: the replica is compared by digest.
    expect(lib).toContain("REMOTE_ARTIFACT_HASH_MISMATCH")
    expect(lib).toContain("RECOVERY_ARTIFACT_LOCAL_HASH_MISMATCH")
  })

  it("keeps the PASS receipt contingent on the full artifact set", () => {
    const receiptIndex = verifier.indexOf("$receipt = [ordered]@{")
    expect(receiptIndex).toBeGreaterThan(-1)
    const receipt = verifier.slice(receiptIndex)
    expect(receipt).toContain("recoveryArtifactsVerified = $verifiedArtifacts.Count")
  })

  it("validates manifest-supplied names before they steer a path", () => {
    expect(lib).toContain("function Assert-RecoveryArtifactName")
    expect(lib).toContain("UNSAFE_RECOVERY_ARTIFACT_NAME")
  })
})
