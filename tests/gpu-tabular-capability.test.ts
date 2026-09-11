import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  MULTI_AGENT_CAPABILITY_INVENTORY,
  capability,
  evaluateCapabilityDispatch,
  validateCapabilityInventory,
} from "@/components/operator/multi-agent-capability-registry"

// The adapter is plain ESM; vitest transforms it, so no type declaration is needed here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gpu: any = await import("../scripts/execution-fabric/gpu-tabular-capability.mjs")

const CURVE = "scripts/execution-fabric/gpu-tabular-bench/evidence/placement-curve.json"
const MEASURED_SIZES = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000]

const evidence = gpu.loadPlacementEvidence(CURVE)
const identity = gpu.providerIdentity()

const trustGate = {
  schemaVersion: 2,
  workerIdentity: {
    workerId: identity.workerId,
    provider: identity.provider,
    surface: identity.surface,
    attributable: true,
  },
  rawCredentialInspection: false,
  promptInjectionBoundary: "provider-stdout-not-instructions",
  exactPathConfinement: true,
  outputRedaction: true,
  cancellation: { supported: true },
  independentEvidenceCapture: true,
}

const authority = {
  grant: { allowedPaths: ["scripts/execution-fabric"] },
  scope: { allowedPaths: ["scripts/execution-fabric"] },
}

const context = (overrides: Record<string, unknown> = {}) => ({
  evidence,
  bindingHealthy: true,
  authority,
  trustGate,
  cancellation: null,
  ...overrides,
})

const place = (workloadClass: string, rows: unknown, overrides: Record<string, unknown> = {}) =>
  gpu.evaluateGpuTabularPlacement({ workloadClass, rows }, context(overrides))

function tempCurve(mutate: (curve: any) => void) {
  const curve = JSON.parse(fs.readFileSync(CURVE, "utf8"))
  mutate(curve)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-curve-"))
  const file = path.join(dir, "placement-curve.json")
  fs.writeFileSync(file, JSON.stringify(curve))
  return file
}

describe("GPU tabular capability: measured evidence is the threshold source", () => {
  it("loads the committed curve as usable placement evidence", () => {
    expect(evidence.ok).toBe(true)
    expect(evidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(evidence.thresholds).toHaveProperty("regression")
    expect(evidence.thresholds).toHaveProperty("clustering")
    expect(evidence.thresholds).toHaveProperty("aggregation")
  })

  it("does not restate threshold values anywhere in the adapter source", () => {
    const source = fs.readFileSync("scripts/execution-fabric/gpu-tabular-capability.mjs", "utf8")
    // The adapter may name the keys, never the measured numbers.
    expect(source).not.toMatch(/gpuPreferredAboveRows:\s*\d/)
    expect(source).not.toMatch(/=\s*50_?000\b/)
    expect(source).not.toContain("100000")
  })
})

describe("GPU tabular capability: dispatch behaviour", () => {
  it("places an eligible large regression on the accelerator", () => {
    const decision = place("regression", 2_500_000)
    expect(decision.placement).toBe("CUDA_DEVICE")
    expect(decision.reasonCode).toBe("GPU_ELIGIBLE_ABOVE_MEASURED_THRESHOLD")
    expect(decision.capabilityId).toBe("gpu-tabular-ml")
    expect(decision.thresholdRows).toBe(50_000)
  })

  it("sends the same regression below the measured threshold to the CPU", () => {
    const decision = place("regression", 49_999)
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_BELOW_MEASURED_THRESHOLD")
    expect(decision.thresholdRows).toBe(50_000)
  })

  it("places a large clustering workload on the accelerator and a small one on the CPU", () => {
    expect(place("clustering", 500_000).placement).toBe("CUDA_DEVICE")
    expect(place("clustering", 500_000).capabilityId).toBe("gpu-clustering")
    expect(place("clustering", 49_999).placement).toBe("CPU")
    expect(place("clustering", 49_999).reasonCode).toBe("CPU_BELOW_MEASURED_THRESHOLD")
  })

  it("treats aggregation as size-aware at its own measured threshold, never as blanket GPU", () => {
    expect(place("aggregation", 99_999).placement).toBe("CPU")
    expect(place("aggregation", 99_999).thresholdRows).toBe(100_000)
    expect(place("aggregation", 100_000).placement).toBe("CUDA_DEVICE")
    expect(place("aggregation", 2_500_000).placement).toBe("CUDA_DEVICE")
    // The threshold must not be the same as the other classes: aggregation is the bracketed one.
    expect(place("aggregation", 50_000).placement).toBe("CPU")
  })

  it("never places dimensional reduction on the accelerator, at any measured size", () => {
    for (const rows of MEASURED_SIZES) {
      const decision = place("dimensional_reduction", rows)
      expect(decision.placement).toBe("CPU")
      expect(decision.reasonCode).toBe("CPU_MEASURED_NO_GPU_BENEFIT")
    }
  })

  it("keeps anomaly detection screening-only and never authoritative", () => {
    const decision = place("anomaly_detection", 2_500_000)
    expect(decision.placement).toBe("SCREENING_ONLY")
    expect(decision.reasonCode).toBe("SCREENING_ONLY_NOT_AUTHORITATIVE")
    expect(decision.placement).not.toBe("CUDA_DEVICE")
    expect(decision.screeningOnlyReason).toMatch(/parity/i)
  })

  it("reports the measurement floor rather than presenting it as a measured crossover", () => {
    const regression = place("regression", 2_500_000)
    const aggregation = place("aggregation", 2_500_000)
    expect(regression.thresholdIsAtMeasurementFloor).toBe(true)
    expect(aggregation.thresholdIsAtMeasurementFloor).toBe(false)
  })
})

describe("GPU tabular capability: every missing or invalid input fails closed to the CPU", () => {
  it("defaults to the CPU when the threshold evidence is absent", () => {
    const missing = gpu.loadPlacementEvidence(path.join(os.tmpdir(), "does-not-exist", "placement-curve.json"))
    expect(missing.ok).toBe(false)
    expect(missing.reasonCode).toBe("THRESHOLD_EVIDENCE_MISSING")
    const decision = place("regression", 2_500_000, { evidence: missing })
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_DEFAULT_THRESHOLD_EVIDENCE_UNAVAILABLE")
  })

  it("defaults to the CPU when the threshold evidence is stale", () => {
    const stale = tempCurve((curve) => {
      const old = new Date(Date.now() - 400 * 86_400_000)
      curve.finishedAt = old.toISOString()
      curve.startedAt = old.toISOString()
    })
    const loaded = gpu.loadPlacementEvidence(stale)
    expect(loaded.ok).toBe(false)
    expect(loaded.reasonCode).toBe("THRESHOLD_EVIDENCE_STALE")
    const decision = place("regression", 2_500_000, { evidence: loaded })
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_DEFAULT_THRESHOLD_EVIDENCE_STALE")
  })

  it("refuses an evidence artifact that promotes itself", () => {
    const selfPromoting = tempCurve((curve) => {
      curve.promoted = true
    })
    const loaded = gpu.loadPlacementEvidence(selfPromoting)
    expect(loaded.ok).toBe(false)
    expect(loaded.detail).toMatch(/promoted/)
    expect(place("regression", 2_500_000, { evidence: loaded }).placement).toBe("CPU")
  })

  it("rejects malformed evidence instead of trusting part of it", () => {
    const noThresholds = tempCurve((curve) => {
      delete curve.thresholds
    })
    const loaded = gpu.loadPlacementEvidence(noThresholds)
    expect(loaded.ok).toBe(false)
    expect(loaded.reasonCode).toBe("THRESHOLD_EVIDENCE_INVALID")
  })

  it("falls back to the CPU when the accelerator binding or runtime is unavailable", () => {
    const decision = place("regression", 2_500_000, { bindingHealthy: false })
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_DEFAULT_BINDING_UNAVAILABLE")
  })

  it("defaults to the CPU for an unknown workload type or an unknown scale", () => {
    expect(place("mystery_workload", 2_500_000).reasonCode).toBe("CPU_DEFAULT_UNKNOWN_WORKLOAD_CLASS")
    expect(place("regression", Number.NaN).reasonCode).toBe("CPU_DEFAULT_SCALE_UNKNOWN")
    expect(place("regression", null).reasonCode).toBe("CPU_DEFAULT_SCALE_UNKNOWN")
    expect(place("regression", -1).reasonCode).toBe("CPU_DEFAULT_SCALE_UNKNOWN")
  })

  it("defaults to the CPU when the authority evidence is missing", () => {
    const decision = place("regression", 2_500_000, { authority: null })
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_DEFAULT_AUTHORITY_MISSING")
  })
})

describe("GPU tabular capability: the preventive trust contract is enforced, not assumed", () => {
  it("denies when the gate is missing or the schema is wrong", () => {
    expect(gpu.assertPreventiveTrustGateV2(null, authority).reasonCode).toBe("PREVENTIVE_TRUST_GATE_V2_MISSING")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, schemaVersion: 1 }, authority).reasonCode)
      .toBe("TRUST_GATE_SCHEMA_MISMATCH")
  })

  it("denies identity that does not match the reviewed binding", () => {
    const wrong = { ...trustGate, workerIdentity: { ...trustGate.workerIdentity, provider: "someone-else" } }
    expect(gpu.assertPreventiveTrustGateV2(wrong, authority).reasonCode).toBe("WORKER_IDENTITY_MISMATCH")
    const notAttributable = {
      ...trustGate,
      workerIdentity: { ...trustGate.workerIdentity, attributable: false },
    }
    expect(gpu.assertPreventiveTrustGateV2(notAttributable, authority).reasonCode).toBe("WORKER_IDENTITY_MISMATCH")
  })

  it("denies each unmet requirement with its own typed reason", () => {
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, rawCredentialInspection: true }, authority).reasonCode)
      .toBe("RAW_CREDENTIAL_INSPECTION_FORBIDDEN")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, outputRedaction: false }, authority).reasonCode)
      .toBe("OUTPUT_REDACTION_REQUIRED")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, exactPathConfinement: false }, authority).reasonCode)
      .toBe("EXACT_PATH_CONFINEMENT_REQUIRED")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, cancellation: { supported: false } }, authority).reasonCode)
      .toBe("CANCELLATION_REQUIRED")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, independentEvidenceCapture: false }, authority).reasonCode)
      .toBe("INDEPENDENT_EVIDENCE_CAPTURE_REQUIRED")
    expect(gpu.assertPreventiveTrustGateV2({ ...trustGate, promptInjectionBoundary: "trust-me" }, authority).reasonCode)
      .toBe("PROMPT_INJECTION_BOUNDARY_UNRECOGNIZED")
  })

  it("requires the grant and scope path sets to match exactly", () => {
    const mismatched = { grant: { allowedPaths: ["scripts/a"] }, scope: { allowedPaths: ["scripts/b"] } }
    expect(gpu.assertPreventiveTrustGateV2(trustGate, mismatched).reasonCode).toBe("EXACT_PATH_SCOPE_MISMATCH")
    const absolute = { grant: { allowedPaths: ["/etc"] }, scope: { allowedPaths: ["/etc"] } }
    expect(gpu.assertPreventiveTrustGateV2(trustGate, absolute).reasonCode).toBe("EXACT_PATH_SCOPE_INVALID")
    const traversal = { grant: { allowedPaths: ["../x"] }, scope: { allowedPaths: ["../x"] } }
    expect(gpu.assertPreventiveTrustGateV2(trustGate, traversal).reasonCode).toBe("EXACT_PATH_SCOPE_INVALID")
    const wildcard = { grant: { allowedPaths: ["scripts/*"] }, scope: { allowedPaths: ["scripts/*"] } }
    expect(gpu.assertPreventiveTrustGateV2(trustGate, wildcard).reasonCode).toBe("EXACT_PATH_SCOPE_INVALID")
    expect(gpu.assertPreventiveTrustGateV2(trustGate, null).reasonCode).toBe("EXACT_PATH_SCOPE_MISSING")
  })

  it("passes only when every requirement is explicitly satisfied", () => {
    const result = gpu.assertPreventiveTrustGateV2(trustGate, authority)
    expect(result.allowed).toBe(true)
    expect(result.reasonCode).toBe("PREVENTIVE_TRUST_GATE_V2_PASSED")
    expect(result.evidence.outputRedaction).toBe(true)
    expect(result.evidence.cancellationSupported).toBe(true)
  })

  it("denies placement when the gate fails, and says why", () => {
    const decision = place("regression", 2_500_000, { trustGate: null })
    expect(decision.placement).toBe("CPU")
    expect(decision.reasonCode).toBe("CPU_DEFAULT_TRUST_GATE_DENIED")
    expect(decision.trustGateReasonCode).toBe("PREVENTIVE_TRUST_GATE_V2_MISSING")
  })
})

describe("GPU tabular capability: cancellation and recovery", () => {
  it("refuses to start work once cancellation is requested", () => {
    const token = gpu.createCancellationToken()
    token.cancel("owner-stopped-it")
    const decision = place("regression", 2_500_000, { cancellation: token })
    expect(decision.placement).toBe("CANCELLED")
    expect(decision.reasonCode).toBe("CANCELLED")
  })

  it("throws a typed cancellation error at each checked point in flight", () => {
    const token = gpu.createCancellationToken()
    expect(() => gpu.assertNotCancelled(token)).not.toThrow()
    token.cancel("mid-flight")
    let thrown: any = null
    try {
      gpu.assertNotCancelled(token)
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeNull()
    expect(thrown.reasonCode).toBe("CANCELLED")
  })

  it("records no accelerator placement for cancelled work", () => {
    const token = gpu.createCancellationToken()
    token.cancel()
    const decision = place("regression", 2_500_000, { cancellation: token })
    const record = gpu.captureIndependentEvidence(decision, { evidenceDigest: evidence.digest })
    expect(record.placement).toBe("CANCELLED")
    expect(record.promoted).toBe(false)
  })

  it("is deterministic, so a replay or recovery cannot produce a different effect", () => {
    const first = place("aggregation", 2_500_000)
    const second = place("aggregation", 2_500_000)
    expect(second).toEqual(first)
    // A cancelled attempt leaves no partial effect: a fresh attempt reaches the same decision.
    const cancelledToken = gpu.createCancellationToken()
    cancelledToken.cancel()
    expect(place("aggregation", 2_500_000, { cancellation: cancelledToken }).placement).toBe("CANCELLED")
    const recovered = place("aggregation", 2_500_000, { cancellation: gpu.createCancellationToken() })
    expect(recovered).toEqual(first)
  })
})

describe("GPU tabular capability: evidence capture and redaction", () => {
  it("captures evidence from the fabric, not from the provider, and leaks no provider path", () => {
    const decision = place("regression", 2_500_000)
    const record = gpu.captureIndependentEvidence(decision, { evidenceDigest: evidence.digest })
    expect(record.capturedBy).toBe("execution-fabric")
    expect(record.thresholdEvidenceDigest).toBe(evidence.digest)
    expect(record.promoted).toBe(false)
    expect(record.binding.provider).toBe("daedalus-cuml-rapids")
    expect(JSON.stringify(record)).not.toContain("/home/")
    expect(JSON.stringify(record)).not.toMatch(/\/(?:Users|mnt)\//)
  })

  it("redacts provider paths and credential-shaped tokens from provider output", () => {
    const raw = "wrote /home/daedalus/gpu-tabular-bench/out.parquet with sk-abcdefghijklmnop1234"
    const redacted = gpu.redactProviderOutput(raw)
    expect(redacted.text).not.toContain("/home/daedalus")
    expect(redacted.text).toContain("<provider-path>")
    expect(redacted.text).toContain("<redacted-token>")
    expect(redacted.redactions.length).toBeGreaterThan(0)
    expect(gpu.redactProviderOutput(null).text).toBe("")
  })
})

describe("GPU tabular capability: the live cancellation proof is machine-checked", () => {
  const LIVE = "scripts/execution-fabric/gpu-tabular-bench/evidence/live-cancellation-proof.json"

  it("records a cancelled accelerator run that stopped, left no partial effect, and did not duplicate", () => {
    expect(fs.existsSync(LIVE), LIVE).toBe(true)
    const proof = JSON.parse(fs.readFileSync(LIVE, "utf8"))
    expect(proof.ok).toBe(true)
    expect(proof.syntheticDataOnly).toBe(true)
    const checks = proof.checks
    // The cancellation landed on real device work, not on process startup.
    expect(checks.acceleratorPhaseObservedBeforeCancel).toBe(true)
    expect(checks.wasActivelyRunningWhenCancelled).toBe(true)
    expect(checks.processGoneAfterCancel).toBe(true)
    expect(checks.cancelledExitCode).toBe(-15)
    // Cancellation left nothing behind, and the device was actually released.
    expect(checks.noArtifactFromCancelledRun).toBe(true)
    expect(checks.deviceReleased).toBe(true)
    expect(checks.deviceComputeProcessesAfterCancel).toEqual([])
    // Recovery produced one artifact; the replay did not add a second.
    expect(checks.recoveryRunCompleted).toBe(true)
    expect(checks.replayCompleted).toBe(true)
    expect(checks.artifactCountAfterReplay).toBe(1)
  })
})

describe("GPU tabular capability: the machine registry stays the enforcement source", () => {
  it("keeps the inventory valid under its own validator", () => {
    const validation = validateCapabilityInventory()
    expect(validation.violations).toEqual([])
    expect(validation.valid).toBe(true)
  })

  it("admits the three evidence-supported scopes through the existing dispatch gate", () => {
    for (const capabilityId of ["gpu-tabular-ml", "gpu-clustering", "gpu-aggregation"]) {
      const record = capability(capabilityId)
      expect(record, capabilityId).toBeDefined()
      const decision = evaluateCapabilityDispatch(record)
      expect(decision.allowed, capabilityId).toBe(true)
      expect(decision.reasonCode).toBe("EXECUTABLE_CAPABILITY_ELIGIBLE")
      expect(record!.status).toBe("PILOT_AUTHORIZED")
      expect(record!.trustGateRef).toBe("control-center/backend/workers.py#validate_preventive_trust_gate_v2")
    }
  })

  it("refuses the accelerator for dimensional reduction and keeps anomaly screening non-authoritative", () => {
    // The evaluator checks execution class before status, so a refused-and-non-executable record
    // reports NOT_EXECUTABLE_WORKER. What matters is that dispatch is denied; the status carries why.
    const dimensional = evaluateCapabilityDispatch(capability("gpu-dimensional-reduction"))
    expect(dimensional.allowed).toBe(false)
    expect(dimensional.reasonCode).toBe("NOT_EXECUTABLE_WORKER")
    expect(capability("gpu-dimensional-reduction")!.status).toBe("REJECTED")
    const anomaly = evaluateCapabilityDispatch(capability("gpu-anomaly-screening"))
    expect(anomaly.allowed).toBe(false)
    expect(anomaly.reasonCode).toBe("NOT_EXECUTABLE_WORKER")
    // AC-12 has no combination for AVAILABLE_UNPROVEN, so the screening surface is recorded as a
    // proven bounded claim that is deliberately NON_EXECUTABLE: it may screen, it may not decide.
    expect(capability("gpu-anomaly-screening")!.status).toBe("PROVEN")
    expect(capability("gpu-anomaly-screening")!.executionClass).toBe("NON_EXECUTABLE")
  })

  it("requires both the registry gate and the measured threshold to agree before the accelerator is used", () => {
    const rows = 2_500_000
    const cases = [
      { capabilityId: "gpu-tabular-ml", workloadClass: "regression" },
      { capabilityId: "gpu-clustering", workloadClass: "clustering" },
      { capabilityId: "gpu-aggregation", workloadClass: "aggregation" },
    ]
    for (const { capabilityId, workloadClass } of cases) {
      const registryAllows = evaluateCapabilityDispatch(capability(capabilityId)).allowed
      const adapterDecision = place(workloadClass, rows)
      expect(registryAllows && adapterDecision.placement === "CUDA_DEVICE", capabilityId).toBe(true)
      // Degrading either gate alone removes the accelerator.
      expect(registryAllows && place(workloadClass, 49_999).placement === "CUDA_DEVICE").toBe(false)
      expect(place(workloadClass, rows, { bindingHealthy: false }).placement).toBe("CPU")
    }
  })

  it("points every GPU evidence reference at a file that exists", () => {
    const gpuRecords = MULTI_AGENT_CAPABILITY_INVENTORY.filter((entry) => entry.capabilityId.startsWith("gpu-"))
    expect(gpuRecords.length).toBe(5)
    for (const record of gpuRecords) {
      expect(record.adapterRef && fs.existsSync(record.adapterRef), String(record.adapterRef)).toBe(true)
      for (const reference of record.evidence) {
        expect(reference.startsWith("http"), reference).toBe(false)
        expect(fs.existsSync(reference), `${record.capabilityId} -> ${reference}`).toBe(true)
      }
      for (const grant of record.authorityGrantRefs) {
        const [file, fragment] = grant.split("#")
        expect(fs.existsSync(file), grant).toBe(true)
        expect(fragment, grant).toBeTruthy()
        expect(fs.readFileSync(file, "utf8").toLowerCase()).toContain(fragment.replace(/-/g, " ").split(" ")[0])
      }
    }
  })
})
