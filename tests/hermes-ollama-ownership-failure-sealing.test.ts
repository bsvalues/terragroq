import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  BOOTSTRAP_CHECKPOINT_EXIT_CODES,
  BOOTSTRAP_CHECKPOINT_MAP_VERSION,
  bindOwnershipOutcome,
  canonicalize,
  OBSERVATION,
  PROBE_FAILURE,
  sha256Bytes,
  stableDigest,
  verifyBoundOwnership,
} from "../scripts/lab-control/hermes/ollama-service/bind-hermes-ollama-ownership.v1.mjs"

const ROOT = process.cwd()
const collectorPath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/diagnose-hermes-ollama-ownership.ps1")
const stagerPath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/stage-hermes-ollama-ownership.v1.ps1")
const binderPath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/bind-hermes-ollama-ownership.v1.mjs")
const H = (character: string) => character.repeat(64)
const NONCE = "d14cfca2-e0de-4db4-85fd-5b2c2eec9e4b"
const HOST = { computerName: "HERMES", machineGuidSha256: H("a") }

function fixture() {
  const launchManifest = {
    schema: "hermes-ollama-ownership-launch/1",
    nonce: NONCE,
    stagedAt: "2026-08-28T12:00:00.000Z",
    collectorSha256: H("1"),
    binderSha256: H("2"),
    stagerSha256: H("3"),
    nodeSha256: H("4"),
    powershellSha256: H("5"),
    dockerSha256: H("6"),
    expectedUacPrompts: 1,
    uacMethod: "Start-Process/RunAs",
    persistentCredential: false,
    sourcePathSha256: H("7"),
    boundPathSha256: H("8"),
    hostIdentity: HOST,
    authority: { readOnly: true, hostMutationAuthorized: false },
  }
  const base = {
    schema: "hermes-ollama-ownership-source/1",
    collectionId: NONCE,
    startedAt: "2026-08-28T12:00:02.000Z",
    completedAt: "2026-08-28T12:00:03.000Z",
    collector: { name: "diagnose-hermes-ollama-ownership.ps1", version: "2.1.0", sha256: H("1"), readOnly: true },
    launch: { nonce: NONCE, manifestSha256: stableDigest(launchManifest) },
    hostIdentity: HOST,
    authority: { elevated: true, persistentCredential: false, readOnly: true, hostMutationAuthorized: false, hostMutationObserved: false },
  }
  return { launchManifest, base }
}

function failureShape(overrides: Record<string, unknown> = {}) {
  return {
    subprobeId: "docker.ownership-signals",
    probeStage: "OBSERVE",
    domain: "container-runtime",
    typedClass: "TOOL_EXIT_NONZERO",
    exceptionType: "System.InvalidOperationException",
    hresult: "0x80131509",
    nativeErrorCode: null,
    fullyQualifiedErrorId: "HERMES_PROBE_FAILURE",
    category: "OperationStopped",
    toolIdentity: "docker.exe",
    externalToolExitCode: 1,
    message: null,
    messageSha256: H("9"),
    ...overrides,
  }
}

function makeReceipt(launchManifest: ReturnType<typeof fixture>["launchManifest"], sourceBytes: Buffer | null, exitCode: number) {
  const bootstrapCheckpoint = Object.entries(BOOTSTRAP_CHECKPOINT_EXIT_CODES).find(([, code]) => code === exitCode)?.[0] ?? null
  return {
    schema: "hermes-ollama-ownership-launch-receipt/2",
    nonce: NONCE,
    manifestSha256: stableDigest(launchManifest),
    collectorSha256: H("1"),
    binderSha256: H("2"),
    stagerSha256: H("3"),
    nodeSha256: H("4"),
    powershellSha256: H("5"),
    startedAt: "2026-08-28T12:00:01.000Z",
    completedAt: "2026-08-28T12:00:04.000Z",
    elevatedProcessId: 4242,
    exitCode,
    uacStartInvocations: 1,
    sourcePresent: sourceBytes !== null,
    sourceSha256: sourceBytes === null ? null : sha256Bytes(sourceBytes),
    disposition: sourceBytes !== null ? "COLLECTOR_SOURCE_PRESENT" : bootstrapCheckpoint === null ? "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN" : "COLLECTOR_BOOTSTRAP_FAILED",
    bootstrapMapVersion: sourceBytes === null ? BOOTSTRAP_CHECKPOINT_MAP_VERSION : null,
    bootstrapCheckpoint: sourceBytes === null ? bootstrapCheckpoint : null,
    bootstrapExitCode: sourceBytes === null ? exitCode : null,
    hostIdentity: HOST,
  }
}

function encode(source: unknown) {
  return Buffer.from(`${canonicalize(source)}\n`, "utf8")
}

function bindSource(source: Record<string, unknown>, exitCode: number) {
  const { launchManifest } = fixture()
  const sourceBytes = encode(source)
  const launchReceipt = makeReceipt(launchManifest, sourceBytes, exitCode)
  const bound = bindOwnershipOutcome({ source, sourceBytes, launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
  return { bound, sourceBytes, launchManifest, launchReceipt }
}

describe("#1050 ownership failure sealing", () => {
  it("binds and verifies the unchanged successful observation path", () => {
    const { base } = fixture()
    const source = { ...base, artifact: OBSERVATION, currentTruthClaim: true, observations: { processEvidence: { listeners: [] }, taskEvidence: { tasks: [] } } }
    const lineage = bindSource(source, 0)
    expect(lineage.bound.artifact).toBe(OBSERVATION)
    expect(lineage.bound.currentTruthClaim).toBe(true)
    expect(verifyBoundOwnership(lineage.bound, { ...lineage, source }).valid).toBe(true)
  })

  it.each([
    ["process.ownership-lineage", "process", "API_FAILURE"],
    ["task.launch-paths", "task-scheduler", "ACCESS_DENIED"],
    ["service.launch-paths", "service-control-manager", "API_FAILURE"],
    ["startup.launch-paths", "startup", "MALFORMED_RESULT"],
    ["file.launch-paths", "filesystem", "ACCESS_DENIED"],
    ["docker.ownership-signals", "container-runtime", "TOOL_EXIT_NONZERO"],
    ["log.ownership-events", "logs", "PARSE_FAILURE"],
  ])("binds %s as a non-truth failure without flattening %s", (subprobeId, domain, typedClass) => {
    const { base } = fixture()
    const source = {
      ...base, artifact: PROBE_FAILURE, currentTruthClaim: false,
      failure: failureShape({ subprobeId, domain, typedClass, externalToolExitCode: typedClass === "TOOL_EXIT_NONZERO" ? 23 : null }),
      partialObservations: [{ subprobeId: "prior.safe-read", observedAt: "2026-08-28T12:00:02.500Z", authoritative: false, value: { count: 1 } }],
    }
    const lineage = bindSource(source, 70)
    expect(lineage.bound).toMatchObject({ artifact: PROBE_FAILURE, currentTruthClaim: false, failure: { disposition: "SEALED_INTERNAL_PROBE_FAILURE", diagnostic: { subprobeId, domain, typedClass } } })
    expect(lineage.bound.failure.partialObservations[0].authoritative).toBe(false)
    expect(verifyBoundOwnership(lineage.bound, { ...lineage, source }).valid).toBe(true)
  })

  it("routes representative thrown subprobes through the real collector failure writer", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ownership-failure-seal-"))
    const specs = [
      { id: "process.ownership-lineage", domain: "process", typedClass: "API_FAILURE", exitCode: null },
      { id: "task.launch-paths", domain: "task-scheduler", typedClass: "ACCESS_DENIED", exitCode: null },
      { id: "service.launch-paths", domain: "service-control-manager", typedClass: "API_FAILURE", exitCode: null },
      { id: "startup.launch-paths", domain: "startup", typedClass: "MALFORMED_RESULT", exitCode: null },
      { id: "file.launch-paths", domain: "filesystem", typedClass: "ACCESS_DENIED", exitCode: null },
      { id: "docker.ownership-signals", domain: "container-runtime", typedClass: "TOOL_EXIT_NONZERO", exitCode: 37 },
      { id: "log.ownership-events", domain: "logs", typedClass: "PARSE_FAILURE", exitCode: null },
    ]
    const liveManifest = { ...fixture().launchManifest, stagedAt: new Date(Date.now() - 60_000).toISOString() }
    const specBase64 = Buffer.from(JSON.stringify(specs), "utf8").toString("base64")
    const command = [
      `$source = Get-Content -Raw -LiteralPath '${collectorPath.replaceAll("'", "''")}'`,
      "$tokens=$null; $errors=$null",
      "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
      "foreach($name in @('Get-Sha256Text','Throw-ProbeFailure','Get-TypedFailure','New-TerminalPacketBytes')){$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true); Invoke-Expression $fn.Extent.Text}",
      `$specs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${specBase64}')) | ConvertFrom-Json`,
      `$CollectionId='${NONCE}'`,
      `$scriptSha256='${H("1")}'`,
      `$manifestSha256='${stableDigest(liveManifest)}'`,
      `$hostIdentity=[ordered]@{computerName='HERMES';machineGuidSha256='${H("a")}'}`,
      "$script:CollectionStartedAt=(Get-Date).ToUniversalTime().AddSeconds(-1).ToString('o')",
      "$script:PartialObservations=[Collections.Generic.List[object]]::new()",
      `foreach($spec in $specs){$script:CurrentSubprobe=[ordered]@{id=[string]$spec.id;stage='OBSERVE';domain=[string]$spec.domain;toolIdentity='fixture'};$resolvedOutput=Join-Path '${directory.replaceAll("'", "''")}' (([string]$spec.id)+'.json');try{Throw-ProbeFailure ([string]$spec.typedClass) 'fixture failure' $spec.exitCode}catch{$failure=Get-TypedFailure $_};$bytes=New-TerminalPacketBytes 'HERMES_OLLAMA_OWNERSHIP_PROBE_FAILURE' $null $failure;[IO.File]::WriteAllBytes($resolvedOutput,$bytes)}`,
    ].join("; ")
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })
      for (const spec of specs) {
        const sourceBytes = fs.readFileSync(path.join(directory, `${spec.id}.json`))
        const source = JSON.parse(sourceBytes.toString("utf8"))
        const launchReceipt = {
          ...makeReceipt(liveManifest, sourceBytes, 70),
          startedAt: new Date(Date.parse(liveManifest.stagedAt) + 1_000).toISOString(),
          completedAt: new Date(Date.now() + 60_000).toISOString(),
        }
        const bound = bindOwnershipOutcome({ source, sourceBytes, launchManifest: liveManifest, launchReceipt, now: new Date(Date.parse(launchReceipt.completedAt) + 1_000) })
        expect(bound).toMatchObject({ artifact: PROBE_FAILURE, failure: { disposition: "SEALED_INTERNAL_PROBE_FAILURE", diagnostic: { subprobeId: spec.id, domain: spec.domain, typedClass: spec.typedClass, externalToolExitCode: spec.exitCode } } })
        expect(verifyBoundOwnership(bound, { source, sourceBytes, launchManifest: liveManifest, launchReceipt }).valid).toBe(true)
      }
    } finally {
      for (const file of fs.readdirSync(directory)) fs.chmodSync(path.join(directory, file), 0o600)
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("preserves an external tool exit code and access denied as different facts", () => {
    const { base } = fixture()
    const tool = bindSource({ ...base, artifact: PROBE_FAILURE, currentTruthClaim: false, failure: failureShape({ externalToolExitCode: 37 }), partialObservations: [] }, 70)
    const denied = bindSource({ ...base, artifact: PROBE_FAILURE, currentTruthClaim: false, failure: failureShape({ typedClass: "ACCESS_DENIED", externalToolExitCode: null, nativeErrorCode: 5, hresult: "0x80070005" }), partialObservations: [] }, 70)
    expect(tool.bound.failure.diagnostic.externalToolExitCode).toBe(37)
    expect(denied.bound.failure.diagnostic).toMatchObject({ typedClass: "ACCESS_DENIED", nativeErrorCode: 5 })
  })

  it("refuses secret-shaped diagnostic text and binds only an outer non-truth failure", () => {
    const { base } = fixture()
    const source = { ...base, artifact: PROBE_FAILURE, currentTruthClaim: false, failure: failureShape({ message: "Authorization: Bearer super-secret-token" }), partialObservations: [] }
    const lineage = bindSource(source, 70)
    expect(lineage.bound).toMatchObject({ artifact: PROBE_FAILURE, currentTruthClaim: false, failure: { disposition: "COLLECTOR_SOURCE_UNBINDABLE", diagnostic: null } })
    expect(JSON.stringify(lineage.bound)).not.toContain("super-secret-token")
  })

  it("binds early collector death from the non-elevated receipt without inventing cause", () => {
    const { launchManifest } = fixture()
    const launchReceipt = makeReceipt(launchManifest, null, 1)
    const bound = bindOwnershipOutcome({ source: null, sourceBytes: null, launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    expect(bound).toMatchObject({ artifact: PROBE_FAILURE, currentTruthClaim: false, failure: { disposition: "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN", diagnostic: null, bootstrap: { checkpoint: null, exitCode: 1 }, exitCode: 1 } })
    expect(verifyBoundOwnership(bound, { source: null, sourceBytes: null, launchManifest, launchReceipt }).valid).toBe(true)
  })

  it("returns process success only for an observation and exit 70 for a durable failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ownership-binder-cli-"))
    try {
      for (const artifact of [OBSERVATION, PROBE_FAILURE]) {
        const suffix = artifact === OBSERVATION ? "success" : "failure"
        const sourcePath = path.join(directory, `${suffix}.source.json`)
        const manifestPath = path.join(directory, `${suffix}.launch.json`)
        const receiptPath = path.join(directory, `${suffix}.receipt.json`)
        const boundPath = path.join(directory, `${suffix}.bound.json`)
        const { launchManifest: seed, base } = fixture()
        const clock = Date.now()
        const launchManifest = { ...seed, stagedAt: new Date(clock - 4_000).toISOString(), sourcePathSha256: sha256Bytes(Buffer.from(path.resolve(sourcePath))), boundPathSha256: sha256Bytes(Buffer.from(path.resolve(boundPath))) }
        const liveBase = { ...base, startedAt: new Date(clock - 3_000).toISOString(), completedAt: new Date(clock - 2_000).toISOString() }
        const source = artifact === OBSERVATION
          ? { ...liveBase, launch: { nonce: NONCE, manifestSha256: stableDigest(launchManifest) }, artifact, currentTruthClaim: true, observations: { processEvidence: { listeners: [] } } }
          : { ...liveBase, launch: { nonce: NONCE, manifestSha256: stableDigest(launchManifest) }, artifact, currentTruthClaim: false, failure: failureShape(), partialObservations: [] }
        const sourceBytes = encode(source)
        const launchReceipt = { ...makeReceipt(launchManifest, sourceBytes, artifact === OBSERVATION ? 0 : 70), startedAt: new Date(clock - 3_500).toISOString(), completedAt: new Date(clock - 1_000).toISOString() }
        fs.writeFileSync(sourcePath, sourceBytes)
        fs.writeFileSync(manifestPath, canonicalize(launchManifest))
        fs.writeFileSync(receiptPath, canonicalize(launchReceipt))
        const result = spawnSync(process.execPath, [binderPath, sourcePath, manifestPath, receiptPath, boundPath], { encoding: "utf8" })
        expect(result.status).toBe(artifact === OBSERVATION ? 0 : 70)
        expect(JSON.parse(result.stdout)).toMatchObject({ artifact, currentTruthClaim: artifact === OBSERVATION })
        expect(fs.existsSync(boundPath)).toBe(false)
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("ignores an untrusted precreated source when the outer receipt did not admit it", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-ownership-untrusted-source-"))
    try {
      const sourcePath = path.join(directory, "attacker.source.json")
      const manifestPath = path.join(directory, "launch.json")
      const receiptPath = path.join(directory, "receipt.json")
      const boundPath = path.join(directory, "bound.json")
      const clock = Date.now()
      const { launchManifest: seed } = fixture()
      const launchManifest = { ...seed, stagedAt: new Date(clock - 4_000).toISOString(), sourcePathSha256: sha256Bytes(Buffer.from(path.resolve(sourcePath))), boundPathSha256: sha256Bytes(Buffer.from(path.resolve(boundPath))) }
      const launchReceipt = { ...makeReceipt(launchManifest, null, 1), startedAt: new Date(clock - 3_000).toISOString(), completedAt: new Date(clock - 1_000).toISOString() }
      fs.writeFileSync(sourcePath, JSON.stringify({ artifact: OBSERVATION, currentTruthClaim: true }))
      fs.writeFileSync(manifestPath, canonicalize(launchManifest))
      fs.writeFileSync(receiptPath, canonicalize(launchReceipt))
      const result = spawnSync(process.execPath, [binderPath, sourcePath, manifestPath, receiptPath, boundPath], { encoding: "utf8" })
      expect(result.status).toBe(70)
      expect(JSON.parse(result.stdout)).toMatchObject({ artifact: PROBE_FAILURE, currentTruthClaim: false, failure: { disposition: "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN", diagnostic: null } })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("never binds a partial or malformed collector source as success", () => {
    const { launchManifest } = fixture()
    const sourceBytes = Buffer.from('{"artifact":"HERMES_OLLAMA_OWNERSHIP_OBSERVATION"', "utf8")
    const launchReceipt = makeReceipt(launchManifest, sourceBytes, 1)
    const bound = bindOwnershipOutcome({ source: null, sourceBytes, launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    expect(bound).toMatchObject({ artifact: PROBE_FAILURE, currentTruthClaim: false, failure: { disposition: "COLLECTOR_SOURCE_UNBINDABLE" } })
  })

  it("rejects tampered source, receipt, manifest, and bound artifacts", () => {
    const { base } = fixture()
    const source = { ...base, artifact: OBSERVATION, currentTruthClaim: true, observations: { processEvidence: { listeners: [] } } }
    const lineage = bindSource(source, 0)
    expect(() => bindOwnershipOutcome({ ...lineage, source, sourceBytes: Buffer.concat([lineage.sourceBytes, Buffer.from(" ")]), now: new Date("2026-08-28T12:00:05.000Z") })).toThrow(/SOURCE_TAMPERED/)
    expect(() => verifyBoundOwnership(lineage.bound, { ...lineage, source, launchReceipt: { ...lineage.launchReceipt, exitCode: 9 } })).toThrow()
    expect(() => verifyBoundOwnership(lineage.bound, { ...lineage, source, launchManifest: { ...lineage.launchManifest, stagedAt: "2026-08-28T11:59:59.000Z" } })).toThrow()
    expect(() => verifyBoundOwnership({ ...lineage.bound, currentTruthClaim: false }, { ...lineage, source })).toThrow(/BOUND_INVALID|BOUND_TAMPERED/)
  })

  it("stages exactly one UAC with an outer receipt and no automatic retry", () => {
    const source = fs.readFileSync(stagerPath, "utf8")
    const collector = fs.readFileSync(collectorPath, "utf8")
    expect(source.match(/^\s*\$elevated\s*=\s*Start-Process/gm)).toHaveLength(1)
    expect(source.match(/-Verb RunAs/g)).toHaveLength(1)
    expect(source).toContain("COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL")
    expect(source).toContain("uacStartInvocations = 1")
    expect(source).toContain("[IO.FileMode]::CreateNew")
    expect(source).toContain("C:\\Program Files\\nodejs\\node.exe")
    expect(source).toContain("4f4c2bbda03106699e49ef2e7914c03d597c355a99a6b9a1b63dca19fe092c01")
    expect(source).toContain("9785001b0dcf755eddb8af294a373c0b87b2498660f724e76c4d53f9c217c7a3")
    expect(source).not.toMatch(/Join-Path\s+\$env:(?:WINDIR|ProgramFiles)/i)
    expect(source).toContain("$env:PSModulePath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules'")
    expect(source).not.toMatch(/Get-Command\s+node/i)
    expect(source).toContain("$env:NODE_OPTIONS = $null")
    expect(source).toContain("Test-TrustedElevatedSource")
    expect(source).not.toMatch(/SetAttributes\(\$sourcePath/i)
    expect(collector).toMatch(/SetAttributes\(\$resolvedOutput[^\n]*ReadOnly/i)
    expect(source.indexOf("$sourceLease = Open-ReadLease $sourcePath")).toBeLessThan(source.indexOf("$sourcePresent = Test-TrustedElevatedSource"))
    expect(source).toMatch(/catch\s*\{[\s\S]*?\$sourcePresent\s*=\s*\$false\s*\}/)
    expect(source.indexOf("$receiptLease = New-WriteLease")).toBeLessThan(source.indexOf("$elevated = Start-Process"))
    expect(source.indexOf("$boundLease = New-WriteLease")).toBeLessThan(source.indexOf("$elevated = Start-Process"))
    expect(source).not.toMatch(/while\s*\(|do\s*\{|for\s*\([^)]*Start-Process/i)
  })

  it("binds all three staged source files and exposes no mutation primitive", () => {
    const collector = fs.readFileSync(collectorPath, "utf8")
    const stager = fs.readFileSync(stagerPath, "utf8")
    const binder = fs.readFileSync(binderPath, "utf8")
    for (const value of [collector, stager, binder]) expect(value).toMatch(/sha256/i)
    for (const subprobe of ["process.ownership-lineage", "task.launch-paths", "service.launch-paths", "startup.launch-paths", "file.launch-paths", "docker.ownership-signals", "log.ownership-events"]) expect(collector).toContain(subprobe)
    expect(collector).toContain("New-ElevatedSourceDirectory")
    expect(collector).toContain("$security.SetOwner($administratorsSid)")
    expect(collector).toContain("[IO.FileMode]::CreateNew")
    expect(collector).not.toMatch(/^\s*(?:Set-(?!StrictMode)|New-|Remove-|Clear-|Enable-|Disable-|Start-|Stop-|Restart-|Register-|Unregister-|Mount-|Dismount-|Initialize-|Format-|Resize-|Repair-|Update-)[A-Za-z]/m)
    expect(collector).not.toMatch(/\b&?\s*\$dockerExe\s+(?:run|start|stop|restart|rm|rmi|pull|build)\b/i)
  })
})
