import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  FRESHNESS_BOUNDS,
  GOLDEN,
  REQUIRED_FACT_IDS,
  bindAttestation,
  canonicalize,
  stableDigest,
  verifyBoundAttestation,
} from "../scripts/lab-control/hermes/host-attestation/bind-hermes-host-attestation.v1.mjs"

const ROOT = process.cwd()
const collectorPath = path.join(ROOT, "scripts/lab-control/hermes/host-attestation/collect-hermes-host-attestation.v1.ps1")
const stagePath = path.join(ROOT, "scripts/lab-control/hermes/host-attestation/stage-hermes-host-attestation.v1.ps1")
const schemaPath = path.join(ROOT, "config/lab-control/hermes-host-attestation.schema.json")
const canonicalOllamaServicePath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/hermes-ollama-service.ps1")
const NOW = new Date("2026-08-27T18:00:00.000Z")

function valueFor(id: string): unknown {
  if (id === "storage.physicalDisks") return [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "OBSERVED", reliabilityEvidence: "EXPOSED", wearPercent: 2, readErrors: 0, writeErrors: 0 }]
  if (id === "storage.volumes") return [{ freePercent: 50 }]
  if (id === "network.specialPortOwners") return [8080, 50080, 50443].map((port) => ({ port, owner: "ABSENT", listeners: [] }))
  if (id === "network.firewallAdmissions") return []
  if (id === "security.firewallProfiles") return ["Domain", "Private", "Public"].map((name) => ({ name, enabled: true, defaultInbound: "Block", defaultOutbound: "Allow" }))
  if (id === "security.defender") return { antivirusEnabled: true, realTimeProtectionEnabled: true, behaviorMonitorEnabled: true, tamperProtection: true }
  if (id === "security.bitlocker") return [{ mountPoint: "C:", protectionStatus: "On", volumeStatus: "FullyEncrypted" }]
  if (id === "security.boot") return { secureBoot: true, tpm: { present: true, ready: true, enabled: true, activated: true } }
  if (id === "operations.tasks") return [
    { path: "\\", name: "HermesP40Guard", state: "Ready", principal: { user: "SYSTEM", runLevel: "Highest" }, actions: [{ execute: "powershell.exe", arguments: "-NoProfile -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\p40-guard.ps1\" -Quiet" }], triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT1H" }], lastResult: 0 },
    { path: "\\", name: "HermesP40Watch", state: "Running", principal: { user: "SYSTEM", runLevel: "Highest" }, actions: [{ execute: "powershell.exe", arguments: "-NoProfile -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\p40-guard.ps1\" -Watch -WatchIntervalS 30 -Quiet" }], triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }], lastResult: 267009 },
  ]
  if (id === "operations.heartbeats") return { processes: [], heartbeatFiles: [{ path: "C:\\HermesLab\\hermes\\p40-watch.heartbeat", writtenAt: "2026-08-27T17:58:30.000Z" }] }
  if (id === "inference.gpus") return [
    { ...GOLDEN.p40, name: "Tesla P40", driver: GOLDEN.p40.driverVersion, driverModelCurrent: "TCC", driverModelPending: "TCC", defaultPowerLimitW: 250, eccModeCurrent: "Enabled", eccModePending: "Enabled", correctedVolatileEcc: 0, uncorrectedVolatileEcc: 0, correctedAggregateEcc: 6, uncorrectedAggregateEcc: 0, temperatureC: 70, role: "FROZEN_LONG_CONTEXT_INFERENCE", computeApps: [] },
    { ...GOLDEN.rtx3050, name: "NVIDIA GeForce RTX 3050", driverModelCurrent: "WDDM", temperatureC: 35, computeApps: [] },
  ]
  if (id === "inference.ollama") return { exe: GOLDEN.ollama.exe, exeSha256: GOLDEN.ollama.exeSha256, version: GOLDEN.ollama.version, bind: GOLDEN.ollama.bind, configurationAgreement: true, models: [...GOLDEN.ollama.models], safeConfig: { exe: GOLDEN.ollama.exe, exeSha256: GOLDEN.ollama.exeSha256, models: GOLDEN.ollama.modelsPath, host: GOLDEN.ollama.bind, gpuUuid: GOLDEN.ollama.gpuUuid, environment: { ...GOLDEN.ollama.configEnvironment }, serviceScriptSha256: GOLDEN.ollama.serviceScriptSha256, repositoryDoctrineSha256: GOLDEN.ollama.serviceScriptSha256 }, liveEnvironment: { state: "OBSERVED", values: { ...GOLDEN.ollama.liveEnvironment } }, task: { path: "\\", name: "WilliamOS-HERMES-Ollama", state: "Running", execute: "powershell.exe", arguments: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\\HermesLab\\hermes\\ollama-service\\hermes-ollama-service.ps1\"", principal: { user: "SYSTEM", runLevel: "Highest" }, triggers: [{ type: "MSFT_TaskBootTrigger", enabled: true }, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT2M" }] } }
  if (id === "inference.dockerContainers") return Object.entries(GOLDEN.containers).map(([name, contract]) => ({ name, ...contract }))
  if (id === "inference.guardBaseline") return { p40EquilibriumC: 68, chassisDeltaC: 35, observedP40C: 70, observedChassisProxyC: 35, observedDeltaC: 35, sampleAgeSeconds: 10, uuid: GOLDEN.p40.uuid, driverModel: "TCC", powerLimitW: 150, overall: "ok", simulated: false, problems: [] }
  if (id === "dr.target") return { capacityAttested: true, accessAttested: true, storageHealthAttested: true, independenceAttested: true, readBackAttested: true }
  return {}
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
    ["HERMES_SECURITY_EXPOSURE_CRITICAL", "network.specialPortOwners", [{ port: 8080, owner: "UNKNOWN", listeners: [] }]],
    ["HERMES_INFERENCE_GOLDEN_DRIFT", "inference.gpus", []],
    ["HERMES_DR_TARGET_UNHEALTHY", "dr.target", { capacityAttested: true, accessAttested: true, storageHealthAttested: true, independenceAttested: true, readBackAttested: false }],
  ])("derives %s from bound evidence", (expected, id, value) => {
    const fixture = makeFixture()
    fixture.source.facts.find((fact: any) => fact.id === id)!.value = value
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: stableDigest(fixture.source), launchReceipt: { ...fixture.launchReceipt, sourceSha256: stableDigest(fixture.source) }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain(expected)
  })

  it.each([
    ["disk reliability unavailable", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "UNKNOWN", reliabilityEvidence: "NOT_EXPOSED" }], "HERMES_STORAGE_CRITICAL"],
    ["P40 corrected ECC drift", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].correctedAggregateEcc = 1; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard baseline drift", "inference.guardBaseline", { ...(valueFor("inference.guardBaseline") as object), chassisDeltaC: 36 }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard sample stale", "inference.guardBaseline", { ...(valueFor("inference.guardBaseline") as object), sampleAgeSeconds: 121 }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["P40 start ceiling reached", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[0].temperatureC = 80; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["proxy not durable", "inference.dockerContainers", Object.entries(GOLDEN.containers).map(([name, contract]) => name === "williamos-hermes-inference-proxy" ? { name, state: "exited", restartPolicy: "no" } : { name, ...contract }), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["RTX compute workload", "inference.gpus", (() => { const rows: any[] = valueFor("inference.gpus") as any[]; rows[1].computeApps = [{ process: "C:\\unexpected.exe" }]; return rows })(), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["stale guard heartbeat", "operations.heartbeats", { processes: [], heartbeatFiles: [{ path: "C:\\HermesLab\\hermes\\p40-watch.heartbeat", writtenAt: "2026-08-27T17:40:00.000Z" }] }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["disk read errors", "storage.physicalDisks", [{ health: "Healthy", operationalStatus: ["Online"], reliabilityState: "OBSERVED", reliabilityEvidence: "EXPOSED", readErrors: 1, writeErrors: 0 }], "HERMES_STORAGE_CRITICAL"],
    ["deployed Ollama doctrine mismatch", "inference.ollama", { ...(valueFor("inference.ollama") as object), safeConfig: { ...((valueFor("inference.ollama") as any).safeConfig), serviceScriptSha256: "0".repeat(64) } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama action executable substitution", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), execute: "cmd.exe" } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama action trailing arguments", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), arguments: `${(valueFor("inference.ollama") as any).task.arguments} -EncodedCommand ZQB4AGkAdAA=` } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard action executable substitution", "operations.tasks", (valueFor("operations.tasks") as any[]).map((task) => task.name === "HermesP40Guard" ? { ...task, actions: [{ ...task.actions[0], execute: "cmd.exe" }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["watch action trailing arguments", "operations.tasks", (valueFor("operations.tasks") as any[]).map((task) => task.name === "HermesP40Watch" ? { ...task, actions: [{ ...task.actions[0], arguments: `${task.actions[0].arguments} -Command exit` }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama extra trigger", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), triggers: [...((valueFor("inference.ollama") as any).task.triggers), { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT1M" }] } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["Ollama expired recheck trigger", "inference.ollama", { ...(valueFor("inference.ollama") as object), task: { ...((valueFor("inference.ollama") as any).task), triggers: ((valueFor("inference.ollama") as any).task.triggers).map((trigger: any) => trigger.type === "MSFT_TaskTimeTrigger" ? { ...trigger, endBoundary: "2026-08-27T17:00:00.000Z" } : trigger) } }, "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["guard extra trigger", "operations.tasks", (valueFor("operations.tasks") as any[]).map((task) => task.name === "HermesP40Guard" ? { ...task, triggers: [...task.triggers, { type: "MSFT_TaskTimeTrigger", enabled: true, repetitionInterval: "PT5M" }] } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
    ["watch expired boot trigger", "operations.tasks", (valueFor("operations.tasks") as any[]).map((task) => task.name === "HermesP40Watch" ? { ...task, triggers: task.triggers.map((trigger: any) => ({ ...trigger, endBoundary: "2026-08-27T17:00:00.000Z" })) } : task), "HERMES_INFERENCE_GOLDEN_DRIFT"],
  ])("fails closed on %s", (_label, id, value, expected) => {
    const fixture = makeFixture()
    fixture.source.facts.find((fact: any) => fact.id === id)!.value = value
    const digest = stableDigest(fixture.source)
    const bound = bindAttestation(fixture.source, { ...fixture, sourceBytesSha256: digest, launchReceipt: { ...fixture.launchReceipt, sourceSha256: digest }, now: NOW })
    expect(bound.priorityOverrides.map((entry: any) => entry.type)).toContain(expected)
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
    expect(source).toContain("xmlSha256 = Get-Sha256Text $xml")
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

  it("publishes the exact fact count and explicit freshness classes in the schema", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"))
    expect(REQUIRED_FACT_IDS).toHaveLength(24)
    expect(schema.properties.facts.minItems).toBe(24)
    expect(schema.properties.facts.maxItems).toBe(24)
    expect(schema.$defs.fact.properties.freshness.properties.class.enum).toEqual(Object.keys(FRESHNESS_BOUNDS))
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
