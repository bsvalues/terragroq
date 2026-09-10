import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  FRESHNESS_BOUNDS,
  GOLDEN,
  COLLECTOR_VERSION_POLICY,
  REQUIRED_FACT_IDS,
  SECURITY_INFERENCE_FACT_IDS,
  bindAttestation,
  bindTargetedResense,
  canonicalize,
  deriveEccCounterEvents,
  stableDigest,
  verifyBoundAttestation,
  verifyTargetedResense,
} from "../scripts/lab-control/hermes/host-attestation/bind-hermes-host-attestation.v1.mjs"

const ROOT = process.cwd()
const collectorPath = path.join(ROOT, "scripts/lab-control/hermes/host-attestation/collect-hermes-host-attestation.v1.ps1")
const stagePath = path.join(ROOT, "scripts/lab-control/hermes/host-attestation/stage-hermes-host-attestation.v1.ps1")
const schemaPath = path.join(ROOT, "config/lab-control/hermes-host-attestation.schema.json")
const canonicalOllamaServicePath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/hermes-ollama-service.ps1")
const NOW = new Date("2026-08-27T18:00:00.000Z")

function refreshBoundDigest(bound: any) {
  const { digestSha256: _omitted, ...binding } = bound.binding
  bound.binding.digestSha256 = stableDigest({ ...bound, binding })
  return bound
}

function valueFor(id: string): unknown {
  if (id === "storage.physicalDisks") return [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "OBSERVED", reliabilityEvidence: "EXPOSED", wearPercent: 2, readErrors: 0, writeErrors: 0 }]
  if (id === "storage.volumes") return [{ freePercent: 50 }]
  if (id === "network.specialPortOwners") return [8080, 50080, 50443].map((port) => ({ port, owner: "ABSENT", listeners: [] }))
  if (id === "network.firewallAdmissions") return []
  if (id === "security.firewallProfiles") return ["Domain", "Private", "Public"].map((name) => ({ name, enabled: true, defaultInbound: "Block", defaultOutbound: "Allow" }))
  if (id === "security.defender") return { antivirusEnabled: true, realTimeProtectionEnabled: true, behaviorMonitorEnabled: true, tamperProtection: true }
  if (id === "security.bitlocker") return [{ mountPoint: "C:", protectionStatus: "On", volumeStatus: "FullyEncrypted" }]
  if (id === "security.boot") return { secureBoot: true, tpm: { present: true, ready: true, enabled: true, activated: true } }
  if (id === "operations.tasks") return {
    expectedTasks: [
      { evidenceState: "OBSERVED", path: "\\", name: "HermesP40Guard", state: "Ready", principal: { user: "SYSTEM", runLevel: "Highest" }, actions: [{ execute: "powershell.exe", arguments: "-NoProfile -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\p40-guard.ps1\" -Quiet" }], triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT1H" }], lastResult: 0, failures: [] },
      { evidenceState: "OBSERVED", path: "\\", name: "HermesP40Watch", state: "Running", principal: { user: "SYSTEM", runLevel: "Highest" }, actions: [{ execute: "powershell.exe", arguments: "-NoProfile -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\p40-guard.ps1\" -Watch -WatchIntervalS 30 -Quiet" }], triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }], lastResult: 267009, failures: [] },
    ],
    inventory: { state: "OBSERVED", matchingTaskIds: ["\\HermesP40Guard", "\\HermesP40Watch"], failures: [] },
  }
  if (id === "operations.heartbeats") return { processes: [], heartbeatFiles: [{ path: "C:\\HermesLab\\hermes\\p40-watch.heartbeat", writtenAt: "2026-08-27T17:58:30.000Z" }] }
  if (id === "inference.gpus") return [
    { ...GOLDEN.p40, name: "Tesla P40", driver: GOLDEN.p40.driverVersion, driverModelCurrent: "TCC", driverModelPending: "TCC", defaultPowerLimitW: 250, eccModeCurrent: "Enabled", eccModePending: "Enabled", correctedVolatileEcc: 0, uncorrectedVolatileEcc: 0, correctedAggregateEcc: 0, uncorrectedAggregateEcc: 0, eccCounterEpoch: { id: "epoch-a", basis: "HOST_BOOT_DRIVER_IDENTITY_PROXY" }, temperatureC: 70, role: "FROZEN_LONG_CONTEXT_INFERENCE", computeApps: [] },
    { ...GOLDEN.rtx3050, name: "NVIDIA GeForce RTX 3050", driverModelCurrent: "WDDM", temperatureC: 35, computeApps: [] },
  ]
  if (id === "inference.ollama") return { exe: GOLDEN.ollama.exe, exeSha256: GOLDEN.ollama.exeSha256, version: GOLDEN.ollama.version, bind: GOLDEN.ollama.bind, pid: 7320, configurationAgreement: true, models: [...GOLDEN.ollama.models], safeConfig: { exe: GOLDEN.ollama.exe, exeSha256: GOLDEN.ollama.exeSha256, models: GOLDEN.ollama.modelsPath, host: GOLDEN.ollama.bind, gpuUuid: GOLDEN.ollama.gpuUuid, environment: { ...GOLDEN.ollama.configEnvironment }, serviceScriptSha256: GOLDEN.ollama.serviceScriptSha256, repositoryDoctrineSha256: GOLDEN.ollama.serviceScriptSha256 }, liveEnvironment: { state: "OBSERVED", values: { ...GOLDEN.ollama.liveEnvironment } }, task: { path: "\\", name: "WilliamOS-HERMES-Ollama", state: "Running", execute: "powershell.exe", arguments: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\ollama-service\\hermes-ollama-service.ps1\"", principal: { user: "SYSTEM", runLevel: "Highest" }, triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT2M" }] } }
  if (id === "inference.dockerContainers") return Object.entries(GOLDEN.containers).map(([name, contract]) => ({ name, ...contract, inferenceClassification: "DECLARED_INFERENCE", inferenceCollisionReasons: [] }))
  if (id === "inference.guardBaseline") return { p40EquilibriumC: 68, chassisDeltaC: 35, observedP40C: 70, observedChassisProxyC: 35, observedDeltaC: 35, sampleAgeSeconds: 10, uuid: GOLDEN.p40.uuid, driverModel: "TCC", powerLimitW: 150, overall: "ok", simulated: false, problems: [] }
  if (id === "dr.target") return { capacityAttested: true, accessAttested: true, storageHealthAttested: true, independenceAttested: true, readBackAttested: true }
  return {}
}

function taskEvidenceWith(change: (task: any) => any) {
  const evidence: any = structuredClone(valueFor("operations.tasks"))
  evidence.expectedTasks = evidence.expectedTasks.map(change)
  return evidence
}

function makeFixture() {
  const observedAt = "2026-08-27T17:59:00.000Z"
  const facts = REQUIRED_FACT_IDS.map((id) => ({
    id,
    domain: id.split(".")[0],
    truth: "OBSERVED",
    value: valueFor(id),
    provenance: { source: "fixture", probe: `fixture:${id}`, collectorVersion: "1.0.0", result: "SUCCESS" },
    freshness: { class: "STATE", boundSeconds: FRESHNESS_BOUNDS.STATE, observedAt, validUntil: "2026-08-27T18:59:00.000Z" },
    redaction: { applied: false, fields: [] },
  }))
  const launchManifest = {
    schema: "hermes-host-attestation-launch/1",
    nonce: "12345678-1234-1234-1234-123456789abc",
    stagedAt: "2026-08-27T17:58:00.000Z",
    collectorSha256: "a".repeat(64),
    binderSha256: "e".repeat(64),
    nodeSha256: "f".repeat(64),
    powershellSha256: "b".repeat(64),
    nativeExecutables: {
      docker: { path: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe", sha256: "1".repeat(64) },
      nvidiaSmi: { path: "C:\\Windows\\System32\\nvidia-smi.exe", sha256: "2".repeat(64) },
      tailscale: { path: "C:\\Program Files\\Tailscale\\tailscale.exe", sha256: "3".repeat(64) },
    },
    expectedUacPrompts: 1,
    uacMethod: "Start-Process/RunAs",
    persistentCredential: false,
    outputPathSha256: "c".repeat(64),
  }
  const source = {
    schema: "hermes-host-attestation-source/1",
    artifact: "HERMES_HOST_ATTESTATION",
    collector: { name: "collect-hermes-host-attestation.v1.ps1", version: "1.0.0", sha256: launchManifest.collectorSha256, readOnly: true },
    authority: {
      boundary: "single-prestaged-uac-read-only", elevated: true, persistentCredential: false, hostMutationAuthorized: false,
      launchNonce: launchManifest.nonce, launchManifestSha256: stableDigest(launchManifest),
    },
    collectionId: launchManifest.nonce,
    collectedAt: "2026-08-27T17:58:30.000Z",
    collectionCompletedAt: "2026-08-27T17:59:30.000Z",
    host: { hostname: "HERMES", machineIdentitySha256: "d".repeat(64), isWindows: true },
    facts,
  }
  const sourceBytesSha256 = stableDigest(source)
  const launchReceipt = {
    schema: "hermes-host-attestation-launch-receipt/1",
    nonce: launchManifest.nonce,
    manifestSha256: stableDigest(launchManifest),
    collectorSha256: launchManifest.collectorSha256,
    binderSha256: launchManifest.binderSha256,
    nodeSha256: launchManifest.nodeSha256,
    powershellSha256: launchManifest.powershellSha256,
    sourceSha256: sourceBytesSha256,
    uacStartInvocations: 1,
    elevatedProcessId: 4100,
    exitCode: 0,
    completedAt: "2026-08-27T17:59:31.000Z",
  }
  const sourceBytes = Buffer.from(canonicalize(source), "utf8")
  return { source, launchManifest, launchReceipt, sourceBytesSha256, sourceBytes }
}

function makeTargetedFixture() {
  const full = makeFixture()
  const { tailscale: _omittedTailscale, ...targetedNativeExecutables } = full.launchManifest.nativeExecutables
  const launchManifest = {
    ...full.launchManifest,
    schema: "hermes-host-attestation-launch/2",
    mode: "SECURITY_INFERENCE",
    requestedFactIds: [...SECURITY_INFERENCE_FACT_IDS],
    nativeExecutables: targetedNativeExecutables,
  }
  const source = {
    ...full.source,
    schema: "hermes-host-attestation-targeted-source/1",
    mode: "SECURITY_INFERENCE",
    requestedFactIds: [...SECURITY_INFERENCE_FACT_IDS],
    authority: { ...full.source.authority, launchManifestSha256: stableDigest(launchManifest) },
    facts: full.source.facts.filter((fact: any) => SECURITY_INFERENCE_FACT_IDS.includes(fact.id)),
  }
  const sourceBytesSha256 = stableDigest(source)
  const launchReceipt = {
    ...full.launchReceipt,
    manifestSha256: stableDigest(launchManifest),
    sourceSha256: sourceBytesSha256,
  }
  const sourceBytes = Buffer.from(canonicalize(source), "utf8")
  return { source, launchManifest, launchReceipt, sourceBytesSha256, sourceBytes }
}

function useCollectorVersion(fixture: ReturnType<typeof makeFixture> | ReturnType<typeof makeTargetedFixture>, version: string) {
  fixture.source.collector.version = version
  for (const fact of fixture.source.facts) fact.provenance.collectorVersion = version
  fixture.sourceBytesSha256 = stableDigest(fixture.source)
  fixture.launchReceipt.sourceSha256 = fixture.sourceBytesSha256
  fixture.sourceBytes = Buffer.from(canonicalize(fixture.source), "utf8")
  return fixture
}

function declaredCollectorVersion() {
  const source = fs.readFileSync(collectorPath, "utf8")
  const match = source.match(/^\$collectorVersion\s*=\s*'([^']+)'/m)
  if (!match) throw new Error("collector version declaration is missing")
  return match[1]
}

describe("targeted security/inference re-sense", () => {
  it("binds and verifies the actual collector 1.1.0 contract through targeted source/1 to targeted/1", () => {
    const version = declaredCollectorVersion()
    expect(version).toBe("1.1.0")
    const fixture = useCollectorVersion(makeTargetedFixture(), version)
    const bound = bindTargetedResense(fixture.source, { ...fixture, now: NOW })

    expect(COLLECTOR_VERSION_POLICY[fixture.source.schema]).toEqual({
      boundSchema: bound.schema,
      historical: ["1.0.0"],
      current: "1.1.0",
    })
    expect(bound.collector.version).toBe("1.1.0")
    expect(bound.facts.every((fact: any) => fact.provenance.collectorVersion === "1.1.0")).toBe(true)
    expect(verifyTargetedResense(bound, { ...fixture, now: NOW })).toMatchObject({ validDigest: true, fresh: true })
  })

  it("rejects unrecognized collector versions and fact provenance that disagrees with the packet collector", () => {
    const unknown = useCollectorVersion(makeTargetedFixture(), "1.2.0")
    expect(() => bindTargetedResense(unknown.source, { ...unknown, now: NOW })).toThrow(/collector version must be one of 1\.0\.0, 1\.1\.0/)

    const mismatch = useCollectorVersion(makeTargetedFixture(), "1.1.0")
    mismatch.source.facts[0].provenance.collectorVersion = "1.0.0"
    mismatch.sourceBytesSha256 = stableDigest(mismatch.source)
    mismatch.launchReceipt.sourceSha256 = mismatch.sourceBytesSha256
    expect(() => bindTargetedResense(mismatch.source, { ...mismatch, now: NOW })).toThrow(/must equal the packet collector version/)
  })

  it("binds and verifies exactly the ten-fact decision closure", () => {
    const fixture = makeTargetedFixture()
    const bound = bindTargetedResense(fixture.source, { ...fixture, now: NOW })
    expect(bound.schema).toBe("hermes-host-attestation-targeted/1")
    expect(bound.facts.map((fact: any) => fact.id).sort()).toEqual([...SECURITY_INFERENCE_FACT_IDS])
    expect(bound.priorityOverrides).toEqual([])
    expect(verifyTargetedResense(bound, { ...fixture, now: NOW })).toMatchObject({ validDigest: true, fresh: true, broadResetRequired: false })
  })

  it("rejects a missing prerequisite even when launch/source declarations agree", () => {
    const fixture = makeTargetedFixture()
    fixture.source.facts = fixture.source.facts.filter((fact: any) => fact.id !== "operations.tasks")
    const digest = stableDigest(fixture.source)
    fixture.launchReceipt.sourceSha256 = digest
    expect(() => bindTargetedResense(fixture.source, { ...fixture, sourceBytesSha256: digest, now: NOW })).toThrow(/exact security\/inference prerequisite closure/)
  })

  it("derives only security and inference decision overrides", () => {
    const fixture = makeTargetedFixture()
    const owners = fixture.source.facts.find((fact: any) => fact.id === "network.specialPortOwners")!
    owners.value = [{ port: 8080, owner: "UNKNOWN", listeners: [{ address: "0.0.0.0", port: 8080 }] }]
    const gpus = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!
    gpus.value = []
    const digest = stableDigest(fixture.source)
    fixture.launchReceipt.sourceSha256 = digest
    const bound = bindTargetedResense(fixture.source, { ...fixture, sourceBytesSha256: digest, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toEqual(["HERMES_SECURITY_EXPOSURE_CRITICAL", "HERMES_INFERENCE_GOLDEN_DRIFT"])
  })

  it.each(["host", "collector", "authority", "collectedAt", "collectionCompletedAt"])(
    "rejects recomputed targeted artifact metadata not authenticated by the source: %s",
    (field) => {
      const fixture = makeTargetedFixture()
      const bound: any = bindTargetedResense(fixture.source, { ...fixture, now: NOW })
      bound[field] = typeof bound[field] === "string" ? "2026-08-27T19:34:00.000Z" : { ...bound[field], tampered: true }
      const { digestSha256: _omitted, ...binding } = bound.binding
      bound.binding.digestSha256 = stableDigest({ ...bound, binding })
      expect(() => verifyTargetedResense(bound, { ...fixture, now: NOW })).toThrow(/AUTHORITY_INVALID/)
    },
  )

  it("rejects a forged source object paired with authentic collected bytes", () => {
    const fixture = makeTargetedFixture()
    fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value = []
    const bound = bindTargetedResense(fixture.source, { ...fixture, now: NOW })
    expect(() => verifyTargetedResense(bound, { ...fixture, now: NOW })).toThrow(/AUTHORITY_INVALID/)
  })

  it("verifies authenticated targeted source bytes with one optional UTF-8 BOM", () => {
    const fixture = makeTargetedFixture()
    const sourceBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonicalize(fixture.source), "utf8")])
    const sourceBytesSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex")
    const launchReceipt = { ...fixture.launchReceipt, sourceSha256: sourceBytesSha256 }
    const bound = bindTargetedResense(fixture.source, { ...fixture, launchReceipt, sourceBytesSha256, now: NOW })

    expect(verifyTargetedResense(bound, { ...fixture, launchReceipt, sourceBytes, now: NOW })).toMatchObject({
      validDigest: true,
      fresh: true,
      broadResetRequired: false,
    })
  })
})

describe("binding current HERMES truth", () => {
  it("binds the exact required fact set to a stable JSON digest and one-UAC receipt", () => {
    const fixture = makeFixture()
    const bound = bindAttestation(fixture.source, { ...fixture, now: NOW })
    expect(bound.facts.map((fact: any) => fact.id).sort()).toEqual([...REQUIRED_FACT_IDS].sort())
    expect(bound.priorityOverrides).toEqual([])
    expect(canonicalize(bound)).not.toContain("undefined")
    expect(JSON.parse(JSON.stringify(bound))).toEqual(bound)
    expect(verifyBoundAttestation(bound, { ...fixture, now: NOW })).toMatchObject({ validDigest: true, fresh: true, broadResetRequired: false })
  })

  it("rejects a self-asserted or replayed UAC boundary", () => {
    const fixture = makeFixture()
    fixture.launchReceipt.uacStartInvocations = 2
    expect(() => bindAttestation(fixture.source, { ...fixture, now: NOW })).toThrow(/AUTHORITY_INVALID/)
  })

  it("rejects a stale bind and later selects only stale or changed prerequisites", () => {
    const fixture = makeFixture()
    expect(() => bindAttestation(fixture.source, { ...fixture, now: new Date("2026-08-27T20:00:00Z") })).toThrow(/STALE_BIND/)
    const bound = bindAttestation(fixture.source, { ...fixture, now: NOW })
    const checked = verifyBoundAttestation(bound, { ...fixture, now: new Date("2026-08-27T20:00:00Z"), changedPrerequisiteIds: ["os.identity"] })
    expect(checked.fresh).toBe(false)
    expect(checked.resenseFactIds).toContain("os.identity")
    expect(checked.broadResetRequired).toBe(false)
  })

  it("rejects missing facts, UNKNOWN defaults, secrets, and digest tampering", () => {
    const missing = makeFixture()
    missing.source.facts.pop()
    const missingDigest = stableDigest(missing.source)
    expect(() => bindAttestation(missing.source, { ...missing, sourceBytesSha256: missingDigest, launchReceipt: { ...missing.launchReceipt, sourceSha256: missingDigest }, now: NOW })).toThrow(/INCOMPLETE/)

    const unknown = makeFixture()
    unknown.source.facts[0].truth = "UNKNOWN"
    unknown.source.facts[0].provenance.result = "READ_ONLY_PROBE_FAILED"
    const unknownDigest = stableDigest(unknown.source)
    expect(() => bindAttestation(unknown.source, { ...unknown, sourceBytesSha256: unknownDigest, launchReceipt: { ...unknown.launchReceipt, sourceSha256: unknownDigest }, now: NOW })).toThrow(/UNKNOWN must carry null/)

    const leaked = makeFixture()
    leaked.source.facts[0].value = { detail: "token=unredacted-value" }
    const leakedDigest = stableDigest(leaked.source)
    expect(() => bindAttestation(leaked.source, { ...leaked, sourceBytesSha256: leakedDigest, launchReceipt: { ...leaked.launchReceipt, sourceSha256: leakedDigest }, now: NOW })).toThrow(/SECRET_REFUSED/)

    const valid = makeFixture()
    const bound = bindAttestation(valid.source, { ...valid, now: NOW })
    bound.facts.find((fact: any) => fact.id === "os.identity")!.value = { changed: true }
    expect(() => verifyBoundAttestation(bound, { ...valid, now: NOW })).toThrow(/DIGEST_INVALID/)
  })

  it("rejects extra facts, partial bearer redaction, nonce mismatch, and digest-only verification", () => {
    const extra = makeFixture()
    extra.source.facts.push({ ...extra.source.facts[0], id: "security.unstagedExtra" })
    const extraDigest = stableDigest(extra.source)
    expect(() => bindAttestation(extra.source, { ...extra, sourceBytesSha256: extraDigest, launchReceipt: { ...extra.launchReceipt, sourceSha256: extraDigest }, now: NOW })).toThrow(/INCOMPLETE/)

    const bearer = makeFixture()
    bearer.source.facts[0].value = { action: "Authorization=[REDACTED] still-secret" }
    const bearerDigest = stableDigest(bearer.source)
    expect(() => bindAttestation(bearer.source, { ...bearer, sourceBytesSha256: bearerDigest, launchReceipt: { ...bearer.launchReceipt, sourceSha256: bearerDigest }, now: NOW })).toThrow(/SECRET_REFUSED/)

    const mismatch = makeFixture()
    mismatch.source.collectionId = "87654321-4321-4321-4321-cba987654321"
    const mismatchDigest = stableDigest(mismatch.source)
    expect(() => bindAttestation(mismatch.source, { ...mismatch, sourceBytesSha256: mismatchDigest, launchReceipt: { ...mismatch.launchReceipt, sourceSha256: mismatchDigest }, now: NOW })).toThrow(/AUTHORITY_INVALID/)

    const valid = makeFixture()
    const bound = bindAttestation(valid.source, { ...valid, now: NOW })
    expect(() => verifyBoundAttestation(bound, { now: NOW })).toThrow(/external source/)
    expect(() => verifyBoundAttestation(bound, { ...valid, sourceBytes: Buffer.from("{}"), now: NOW })).toThrow(/AUTHORITY_INVALID/)
  })

  it.each([
    ["HERMES_STORAGE_CRITICAL", "storage.physicalDisks", [{ health: "Warning", operationalStatus: ["Online"] }]],
    ["HERMES_SECURITY_EXPOSURE_CRITICAL", "network.specialPortOwners", [{ port: 8080, owner: "UNKNOWN", listeners: [{ address: "0.0.0.0", port: 8080 }] }]],
    ["HERMES_INFERENCE_GOLDEN_DRIFT", "inference.gpus", []],
    ["HERMES_DR_TARGET_UNHEALTHY", "dr.target", { status: "UNHEALTHY", failureEvidence: [{ kind: "READ_BACK_FAILED" }] }],
  ])("derives %s from bound evidence", (expected, id, value) => {
    const fixture = makeFixture()
    fixture.source.facts.find((fact: any) => fact.id === id)!.value = value
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: stableDigest(fixture.source), launchReceipt: { ...fixture.launchReceipt, sourceSha256: stableDigest(fixture.source) }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain(expected)
  })

  it.each([
    ["guard baseline drift", "inference.guardBaseline", { ...(valueFor("inference.guardBaseline") as object), chassisDeltaC: 36 }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard sample stale", "inference.guardBaseline", { ...(valueFor("inference.guardBaseline") as object), sampleAgeSeconds: 121 }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["P40 start ceiling reached", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].temperatureC = 80; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["P40 uncorrected volatile ECC", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].uncorrectedVolatileEcc = 1; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["P40 uncorrected aggregate ECC", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].uncorrectedAggregateEcc = 1; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["proxy not durable", "inference.dockerContainers", Object.entries(GOLDEN.containers).map(([name, contract]) => name === "williamos-hermes-inference-proxy" ? { name, state: "exited", restartPolicy: "no" } : { name, ...contract }), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["unrelated P40 compute workload", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].computeApps = [{ pid: 9000, process: "C:\\unexpected.exe", lineage: [] }]; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["stale guard heartbeat", "operations.heartbeats", { processes: [], heartbeatFiles: [{ path: "C:\\HermesLab\\hermes\\p40-watch.heartbeat", writtenAt: "2026-08-27T17:40:00.000Z" }] }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["disk read errors", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "OBSERVED", reliabilityEvidence: "EXPOSED", readErrors: 1, writeErrors: 0 }], "HERMES_STORAGE_CRITICAL"],
    ["disk stressed despite nominal health", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Stressed"], reliabilityState: "UNKNOWN", reliabilityEvidence: "NOT_EXPOSED", readErrors: null, writeErrors: null }], "HERMES_STORAGE_CRITICAL"],
    ["disk lost communication despite nominal health", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Lost Communication"], reliabilityState: "UNKNOWN", reliabilityEvidence: "NOT_EXPOSED", readErrors: null, writeErrors: null }], "HERMES_STORAGE_CRITICAL"],
    ["deployed Ollama doctrine mismatch", "inference.ollama", { ...(valueFor("inference.ollama") as object), safeConfig: { ...((valueFor("inference.ollama") as any).safeConfig), serviceScriptSha256: "0".repeat(64) } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama action executable substitution", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), execute: "cmd.exe" } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama action trailing arguments", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), arguments: `${(valueFor("inference.ollama") as any).task.arguments} -EncodedCommand ZQB4AGkAdAA=` } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard action executable substitution", "operations.tasks", taskEvidenceWith((task) => task.name === "HermesP40Guard" ? { ...task, actions: [{ ...task.actions[0], execute: "cmd.exe" }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["watch action trailing arguments", "operations.tasks", taskEvidenceWith((task) => task.name === "HermesP40Watch" ? { ...task, actions: [{ ...task.actions[0], arguments: `${task.actions[0].arguments} -Command exit` }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama extra trigger", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), triggers: [...((valueFor("inference.ollama") as any).task.triggers), { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT1M" }] } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama expired recheck trigger", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), triggers: ((valueFor("inference.ollama") as any).task.triggers).map((trigger: any) => trigger.type === "MSFT_TaskTimeTrigger" ? { ...trigger, endBoundary: "2026-08-27T17:00:00.000Z" } : trigger) } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard extra trigger", "operations.tasks", taskEvidenceWith((task) => task.name === "HermesP40Guard" ? { ...task, triggers: [...task.triggers, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT5M" }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["watch expired boot trigger", "operations.tasks", taskEvidenceWith((task) => task.name === "HermesP40Watch" ? { ...task, triggers: task.triggers.map((trigger: any) => ({ ...trigger, endBoundary: "2026-08-27T17:00:00.000Z" })) } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
  ])("fails closed on %s", (_label, id, value, expected) => {
    const fixture = makeFixture()
    fixture.source.facts.find((fact: any) => fact.id === id)!.value = value
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain(expected)
  })

  it.each([
    ["missing disk reliability telemetry", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "UNKNOWN", reliabilityEvidence: "NOT_EXPOSED", wearPercent: null, readErrors: null, writeErrors: null }], "HERMES_STORAGE_CRITICAL"],
    ["Secure Boot/TPM hardening gap", "security.boot", { secureBoot: false, tpm: { present: false, ready: false, enabled: false, activated: false } }, "HERMES_SECURITY_EXPOSURE_CRITICAL"],
    ["Defender hardening gap", "security.defender", { antivirusEnabled: false, realTimeProtectionEnabled: false, behaviorMonitorEnabled: false, tamperProtection: false }, "HERMES_SECURITY_EXPOSURE_CRITICAL"],
    ["BitLocker hardening gap", "security.bitlocker", [{ mountPoint: "C:", protectionStatus: "Off", volumeStatus: "FullyDecrypted" }], "HERMES_SECURITY_EXPOSURE_CRITICAL"],
    ["unknown disk health evidence", "storage.physicalDisks", null, "HERMES_STORAGE_CRITICAL"],
    ["unknown listener ownership evidence", "network.specialPortOwners", null, "HERMES_SECURITY_EXPOSURE_CRITICAL"],
    ["unattested DR target", "dr.target", null, "HERMES_DR_TARGET_UNHEALTHY"],
  ])("does not misclassify %s", (_label, id, value, excluded) => {
    const fixture = makeFixture()
    const fact = fixture.source.facts.find((entry: any) => entry.id === id)!
    if (value === null) {
      fact.truth = "UNKNOWN"
      fact.value = null
      fact.provenance.result = "READ_ONLY_PROBE_FAILED"
    } else {
      fact.value = value
    }
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain(excluded)
  })

  it("admits an exact Ollama runner only when its lineage reaches the pinned service", () => {
    const fixture = makeFixture()
    const gpus: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value as any[]
    gpus[0].computeApps = [{ pid: 8123, process: "C:\\Windows\\Temp\\ollama-1234\\ollama_llama_server.exe", lineage: [{ pid: 7320, process: "ollama.exe", exe: GOLDEN.ollama.exe }] }]
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("rejects a runner-shaped P40 process without pinned Ollama lineage", () => {
    const fixture = makeFixture()
    const gpus: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value as any[]
    gpus[0].computeApps = [{ pid: 8123, process: "C:\\Windows\\Temp\\ollama-1234\\ollama_llama_server.exe", lineage: [{ pid: 7000, process: "unrelated.exe", exe: "C:\\unrelated.exe" }] }]
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("does not treat ordinary RTX display processes as P40 inference drift", () => {
    const fixture = makeFixture()
    const gpus: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value as any[]
    gpus[1].computeApps = [{ pid: 1864, process: "C:\\Windows\\System32\\dwm.exe", lineage: [] }]
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it.each([0, 1, 6, 100])("does not use corrected aggregate ECC=%s as a golden configuration invariant", (correctedAggregateEcc) => {
    const fixture = makeFixture()
    const gpus: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value
    gpus[0].correctedAggregateEcc = correctedAggregateEcc
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it.each([
    ["corrected volatile missing", "correctedVolatileEcc", null],
    ["corrected aggregate malformed", "correctedAggregateEcc", "UNKNOWN"],
    ["corrected aggregate fractional", "correctedAggregateEcc", 1.5],
  ])("keeps inference red when %s", (_label, field, value) => {
    const fixture = makeFixture()
    const gpus: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.gpus")!.value
    gpus[0][field] = value
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("records corrected ECC changes and decreases as events without claiming health recovery", () => {
    const base = { uuid: GOLDEN.p40.uuid, eccCounterEpoch: { id: "epoch-a" }, correctedVolatileEcc: 2, correctedAggregateEcc: 6, uncorrectedVolatileEcc: 0, uncorrectedAggregateEcc: 0 }
    expect(deriveEccCounterEvents(base, { ...base, correctedAggregateEcc: 7 })).toContainEqual(expect.objectContaining({ type: "CORRECTED_AGGREGATE_INCREMENT", delta: 1, hardFailure: false }))
    expect(deriveEccCounterEvents(base, { ...base, correctedAggregateEcc: 0 })).toContainEqual(expect.objectContaining({ type: "COUNTER_EPOCH_OR_RESET_DISCONTINUITY", previous: 6, current: 0, hardFailure: false }))
    expect(deriveEccCounterEvents(base, { ...base, eccCounterEpoch: { id: "epoch-b" }, correctedAggregateEcc: 0 })).toContainEqual(expect.objectContaining({ type: "COUNTER_EPOCH_CHANGED", hardFailure: false }))
    expect(deriveEccCounterEvents(base, { ...base, uncorrectedAggregateEcc: 1 })).toContainEqual(expect.objectContaining({ type: "UNCORRECTED_ECC_OBSERVED", field: "uncorrectedAggregateEcc", current: 1, hardFailure: true }))
  })

  it("allows task inventory coverage conflict when exact inference guard tasks remain proven", () => {
    const fixture = makeFixture()
    const tasks = fixture.source.facts.find((fact: any) => fact.id === "operations.tasks")!
    tasks.truth = "CONFLICTING"
    tasks.provenance.result = "CONTRADICTION_PRESERVED"
    tasks.value.inventory = { state: "PARTIAL", matchingTaskIds: [], failures: [{ subprobe: "Get-ScheduledTask/all", exceptionType: "CimException", fullyQualifiedErrorId: "HRESULT 0x80070005", category: "PermissionDenied", hresult: "0x80070005", nativeErrorCode: 5 }] }
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("fails inference closed when an exact expected guard task probe fails", () => {
    const fixture = makeFixture()
    const tasks: any = fixture.source.facts.find((fact: any) => fact.id === "operations.tasks")!
    tasks.truth = "CONFLICTING"
    tasks.provenance.result = "CONTRADICTION_PRESERVED"
    tasks.value.expectedTasks[0] = { name: "HermesP40Guard", evidenceState: "UNKNOWN", failures: [{ subprobe: "Export-ScheduledTask", exceptionType: "CimException", fullyQualifiedErrorId: "AccessDenied", category: "PermissionDenied", hresult: "0x80070005", nativeErrorCode: 5 }] }
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it.each([undefined, null])("requires exact task evidenceState OBSERVED when the value is %s", (evidenceState) => {
    const fixture = makeFixture()
    const tasks: any = fixture.source.facts.find((fact: any) => fact.id === "operations.tasks")!
    if (evidenceState === undefined) delete tasks.value.expectedTasks[0].evidenceState
    else tasks.value.expectedTasks[0].evidenceState = evidenceState
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("does not classify a proven unrelated disposable container as inference drift", () => {
    const fixture = makeFixture()
    const containers: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.dockerContainers")!.value
    containers.push({ name: "tf-rel-evidence", state: "created", restartPolicy: "no", inspectionState: "OBSERVED", inferenceClassification: "UNRELATED_RESIDENT", inferenceCollisionReasons: [] })
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).not.toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it.each(["PROTECTED_GPU_ACCESS", "PROTECTED_MODEL_STORE_MOUNT", "PROTECTED_OLLAMA_PORT", "PROTECTED_INFERENCE_PROXY_PATH"])("keeps an extra container with %s collision in inference drift", (reason) => {
    const fixture = makeFixture()
    const containers: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.dockerContainers")!.value
    containers.push({ name: "tf-rel-evidence", state: "created", restartPolicy: "no", inspectionState: "OBSERVED", inferenceClassification: "PROTECTED_INFERENCE_COLLISION", inferenceCollisionReasons: [reason] })
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })

  it("fails closed when an extra container has not been collision-classified", () => {
    const fixture = makeFixture()
    const containers: any[] = fixture.source.facts.find((fact: any) => fact.id === "inference.dockerContainers")!.value
    containers.push({ name: "mystery", state: "created", restartPolicy: "no" })
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain("HERMES_INFERENCE_GOLDEN_DRIFT")
  })
})

describe("the staged collector remains read-only", () => {
  it("contains every required fact exactly once and no host mutation primitive", () => {
    const source = fs.readFileSync(collectorPath, "utf8")
    for (const id of REQUIRED_FACT_IDS) expect(source.match(new RegExp(`Add-Fact '${id.replace(".", "\\.")}'`, "g"))).toHaveLength(1)
    expect(source).not.toMatch(/^\s*(?:Set-(?!StrictMode)|New-|Remove-|Clear-|Enable-|Disable-|Start-|Stop-|Restart-|Register-|Unregister-|Mount-|Dismount-|Initialize-|Format-|Resize-|Repair-|Update-)[A-Za-z]/m)
    expect(source).not.toMatch(/\bdocker\s+(?:run|start|stop|restart|rm|rmi|pull|build|compose\s+up)\b/i)
    expect(source).not.toMatch(/\b(?:Set-Content|Out-File|Add-Content|Export-Clixml|schtasks\.exe)\b/i)
    expect(source).not.toMatch(/tailscaleStatus\s*=\s*Protect-Text/)
    expect(source).not.toMatch(/\bxml\s*=\s*Protect-Text/)
    expect(source).toContain("xmlSha256 = if ($xml) { Get-Sha256Text $xml } else { $null }")
    expect(source).toContain("[IO.FileMode]::CreateNew")
    expect(source).not.toMatch(/Get-Command\s+(?:docker|tailscale|nvidia-smi)/i)
    expect(source).not.toMatch(/&\s*\$pinnedExe/)
    expect(source).toContain("Get-TrustedExecutable 'docker'")
    expect(source).toContain("reliabilityState = 'UNKNOWN'")
    expect(source).toContain("services = if ($services.Count -gt 0)")
    expect(source).not.toMatch(/\$special\s+-and\s+\[string\]\$rule\.Profile/)
    expect(source).toContain("$activeSurface -and [string]$rule.Profile")
  })

  it("has exactly one visible authority transition and no credential persistence/bypass", () => {
    const source = fs.readFileSync(stagePath, "utf8")
    expect(source.match(/^\s*\$elevated\s*=\s*Start-Process/gm)).toHaveLength(1)
    expect(source.match(/-Verb\s+RunAs/g)).toHaveLength(1)
    expect(source).toMatch(/-WindowStyle\s+Hidden/)
    expect(source).not.toMatch(/PSCredential|Get-Credential|ConvertTo-SecureString|cmdkey|runas\.exe|ExecutionPolicy\s+Bypass/i)
    expect(source).toContain("FileMode]::CreateNew")
    expect(source).toContain("OUTPUT_NOT_DEDICATED")
    expect(source).toContain("[IO.FileShare]::Read")
    expect(source).toContain("Get-LeasedSha256 $collectorLease")
    expect(source).toContain("Get-LeasedSha256 $manifestLease")
    expect(source).toContain("Get-LeasedSha256 $sourceLease")
    expect(source).toContain("Open-ReadLease $receiptPath")
    expect(source).toContain("$env:PSModulePath =")
  })

  it("pins the targeted collector to the exact ten-fact closure independently of caller arguments", () => {
    const source = fs.readFileSync(collectorPath, "utf8")
    const allowlist = source.match(/\$securityInferenceFactIds\s*=\s*@\(([\s\S]*?)\r?\n\)/)![1]
    const declared = [...allowlist.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect([...new Set(declared)].sort()).toEqual([...SECURITY_INFERENCE_FACT_IDS])
    expect(source).toContain("(($requestedFactIds | Sort-Object) -join ',') -cne (($securityInferenceFactIds | Sort-Object) -join ',')")
  })

  it("extracts literal Ollama variables and preserves classified task subprobe failures", () => {
    const source = fs.readFileSync(collectorPath, "utf8")
    expect(source).toContain("[regex]::Escape($Name)")
    expect(source).not.toContain('"(?m)^`$$Name\\s*=\\s*\'([^\']+)\'"')
    for (const field of ["subprobe", "exceptionType", "fullyQualifiedErrorId", "category", "hresult", "nativeErrorCode"]) expect(source).toContain(field)
    expect(source).toContain("expectedTasks")
    expect(source).toContain("inventory")
  })

  it.skipIf(process.platform !== "win32")("classifies a JSON-escaped Windows bind as a protected model-store collision", () => {
    const source = fs.readFileSync(collectorPath, "utf8")
    const functionSource = source.match(/function Get-ProtectedModelStoreMountCollision[^\r\n]*\{[\s\S]*?^\}/m)?.[0]
    expect(functionSource).toBeTruthy()
    const mounts = JSON.stringify([{ Type: "bind", Source: "D:\\HermesData\\ollama\\models", Destination: "/root/.ollama/models" }]).replaceAll("'", "''")
    const command = `$ProgressPreference = 'SilentlyContinue'\n${functionSource}\n$mounts = ConvertFrom-Json '${mounts}'\nGet-ProtectedModelStoreMountCollision $mounts`
    const classification = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { encoding: "utf8" }).trim()

    expect(classification).toBe("PROTECTED_MODEL_STORE_MOUNT")
    expect(source).toContain("$modelStoreCollision = Get-ProtectedModelStoreMountCollision $mounts")
    expect(source).toContain("$collisionReasons.Add($modelStoreCollision)")
  })

  it("publishes the exact fact count and explicit freshness classes in the schema", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"))
    expect(REQUIRED_FACT_IDS).toHaveLength(24)
    expect(schema.properties.facts.minItems).toBe(24)
    expect(schema.properties.facts.maxItems).toBe(24)
    const schemaFactIds = schema.properties.facts.allOf.map((rule: any) => rule.contains.properties.id.const)
    expect([...schemaFactIds].sort()).toEqual([...REQUIRED_FACT_IDS].sort())
    expect(schema.properties.facts.allOf.every((rule: any) => rule.minContains === 1 && rule.maxContains === 1)).toBe(true)
    expect([...schema.properties.resense.properties.factIds.items.enum].sort()).toEqual([...REQUIRED_FACT_IDS].sort())
    expect(schema.$defs.fact.properties.freshness.properties.class.enum).toEqual(Object.keys(FRESHNESS_BOUNDS))
    expect(schema.properties.collector.properties.version.enum).toEqual(["1.0.0", "1.1.0"])
    expect(schema.$defs.fact.properties.provenance.properties.collectorVersion.enum).toEqual(["1.0.0", "1.1.0"])
  })

  it("pins Ollama doctrine with the collector's BOM/CRLF-normalized UTF-8 digest", () => {
    const normalized = fs.readFileSync(canonicalOllamaServicePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
    expect(crypto.createHash("sha256").update(normalized, "utf8").digest("hex")).toBe(GOLDEN.ollama.serviceScriptSha256)
  })
})

describe("collector truth-marker normalization", () => {
  it("binds an authority-bound UNKNOWN marker as UNKNOWN rather than OBSERVED", () => {
    const fixture = makeFixture()
    const growth = fixture.source.facts.find((fact: any) => fact.id === "storage.growth")!
    growth.truth = "OBSERVED"
    growth.value = { __truth: "UNKNOWN", __value: null }
    growth.provenance.result = "SUCCESS"
    const digest = stableDigest(fixture.source)
    const launchReceipt = { ...fixture.launchReceipt, sourceSha256: digest }
    const bound = bindAttestation(fixture.source, { ...fixture, launchReceipt, sourceBytesSha256: digest, now: NOW })
    expect(bound.facts.find((fact: any) => fact.id === "storage.growth")).toMatchObject({ truth: "UNKNOWN", value: null, provenance: { result: "READ_ONLY_PROBE_FAILED" } })
    expect(verifyBoundAttestation(bound, { launchManifest: fixture.launchManifest, launchReceipt, source: fixture.source, sourceBytes: Buffer.from(canonicalize(fixture.source)), now: NOW }).validDigest).toBe(true)
  })
})

describe("persisted selective re-sense validation", () => {
  it.each([
    ["unknown", ["not.a.fact"]],
    ["duplicate", ["inference.gpus", "inference.gpus"]],
  ])("rejects %s fact IDs even under a recomputed artifact digest", (_label, factIds) => {
    const fixture = makeFixture()
    const bound = bindAttestation(fixture.source, { ...fixture, now: NOW })
    bound.resense.factIds = factIds
    refreshBoundDigest(bound)
    expect(() => verifyBoundAttestation(bound, { ...fixture, now: NOW })).toThrow(/resense factIds/)
  })
})
