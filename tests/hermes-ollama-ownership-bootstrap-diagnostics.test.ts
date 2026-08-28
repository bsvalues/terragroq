import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  bindOwnershipOutcome,
  BOOTSTRAP_CHECKPOINT_EXIT_CODES,
  BOOTSTRAP_CHECKPOINT_MAP_VERSION,
  BOUND_SCHEMA,
  canonicalize,
  LEGACY_BOUND_SCHEMA,
  PROBE_FAILURE,
  sha256Bytes,
  stableDigest,
  verifyBoundOwnership,
} from "../scripts/lab-control/hermes/ollama-service/bind-hermes-ollama-ownership.v1.mjs"

const ROOT = process.cwd()
const collectorPath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/diagnose-hermes-ollama-ownership.ps1")
const stagerPath = path.join(ROOT, "scripts/lab-control/hermes/ollama-service/stage-hermes-ollama-ownership.v1.ps1")
const H = (character: string) => character.repeat(64)
const NONCE = "8b62082c-fdef-4a28-9ad8-d94a3f8cce90"
const HOST = { computerName: "HERMES", machineGuidSha256: H("a") }

function manifest() {
  return {
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
}

function receipt(exitCode: number, checkpoint: string | null, schema = "hermes-ollama-ownership-launch-receipt/2") {
  const launchManifest = manifest()
  const current = schema.endsWith("/2")
  return {
    schema,
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
    sourcePresent: false,
    sourceSha256: null,
    disposition: current ? (checkpoint === null ? "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN" : "COLLECTOR_BOOTSTRAP_FAILED") : "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL",
    hostIdentity: HOST,
    ...(current ? { bootstrapMapVersion: BOOTSTRAP_CHECKPOINT_MAP_VERSION, bootstrapCheckpoint: checkpoint, bootstrapExitCode: exitCode } : {}),
  }
}

function parsePowerShellMap(source: string, variable: string) {
  const block = source.match(new RegExp(`\\$${variable}\\s*=\\s*\\[ordered\\]@\\{([\\s\\S]*?)\\n\\}`))?.[1]
  if (!block) throw new Error(`missing ${variable}`)
  return Object.fromEntries([...block.matchAll(/^\s*(BOOTSTRAP_[A-Z_]+)\s*=\s*(\d+)\s*$/gm)].map((match) => [match[1], Number(match[2])]))
}

describe("#1052 ownership bootstrap diagnostics", () => {
  it("keeps the collector, stager, and binder on one immutable versioned checkpoint map", () => {
    const collector = fs.readFileSync(collectorPath, "utf8")
    const stager = fs.readFileSync(stagerPath, "utf8")
    expect(parsePowerShellMap(collector, "script:BootstrapCheckpointExitCodes")).toEqual(BOOTSTRAP_CHECKPOINT_EXIT_CODES)
    expect(parsePowerShellMap(stager, "bootstrapCheckpointExitCodes")).toEqual(BOOTSTRAP_CHECKPOINT_EXIT_CODES)
    expect(collector).toContain(`$script:BootstrapCheckpointMapVersion = '${BOOTSTRAP_CHECKPOINT_MAP_VERSION}'`)
    expect(stager).toContain(`$bootstrapCheckpointMapVersion = '${BOOTSTRAP_CHECKPOINT_MAP_VERSION}'`)
    for (const checkpoint of Object.keys(BOOTSTRAP_CHECKPOINT_EXIT_CODES)) {
      expect(collector.match(new RegExp(`Invoke-OwnershipBootstrapCheckpoint '${checkpoint}'`, "g"))).toHaveLength(1)
    }
  })

  it.each(Object.entries(BOOTSTRAP_CHECKPOINT_EXIT_CODES))("executes production checkpoint failure %s as exit %i without leaking exception text", (checkpoint, exitCode) => {
    const secret = "Authorization: Bearer bootstrap-secret-must-not-cross"
    const command = [
      `$source = Get-Content -Raw -LiteralPath '${collectorPath.replaceAll("'", "''")}'`,
      "$tokens=$null; $errors=$null",
      "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
      "$assignment=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$script:BootstrapCheckpointExitCodes'},$true)",
      "$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-OwnershipBootstrapCheckpoint'},$true)",
      "Invoke-Expression $assignment.Extent.Text",
      "Invoke-Expression $function.Extent.Text",
      `Invoke-OwnershipBootstrapCheckpoint '${checkpoint}' { throw '${secret}' }`,
    ].join("; ")
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })
    expect(result.status).toBe(exitCode)
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret)
  })

  it.each([...Object.entries(BOOTSTRAP_CHECKPOINT_EXIT_CODES), ["UNKNOWN", 199] as [string, number]])("executes production stager mapping for %s exit %i", (checkpoint, exitCode) => {
    const command = [
      `$source = Get-Content -Raw -LiteralPath '${stagerPath.replaceAll("'", "''")}'`,
      "$tokens=$null; $errors=$null",
      "$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
      "foreach($name in @('$bootstrapCheckpointMapVersion','$bootstrapCheckpointExitCodes')){$assignment=$ast.Find({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq $name},$true);Invoke-Expression $assignment.Extent.Text}",
      "$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-OwnershipBootstrapDisposition'},$true)",
      "Invoke-Expression $function.Extent.Text",
      `Resolve-OwnershipBootstrapDisposition ${exitCode} | ConvertTo-Json -Compress`,
    ].join("; ")
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      mapVersion: BOOTSTRAP_CHECKPOINT_MAP_VERSION,
      checkpoint: checkpoint === "UNKNOWN" ? null : checkpoint,
      exitCode,
      disposition: checkpoint === "UNKNOWN" ? "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN" : "COLLECTOR_BOOTSTRAP_FAILED",
    })
  })

  it.each(Object.entries(BOOTSTRAP_CHECKPOINT_EXIT_CODES))("binds checkpoint %s and exit %i without claiming host truth", (checkpoint, exitCode) => {
    const launchManifest = manifest()
    const launchReceipt = receipt(exitCode, checkpoint)
    const bound = bindOwnershipOutcome({ launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    expect(bound).toMatchObject({
      schema: BOUND_SCHEMA,
      artifact: PROBE_FAILURE,
      currentTruthClaim: false,
      authority: { hostMutationObserved: false, uacStartInvocations: 1 },
      failure: { disposition: "COLLECTOR_BOOTSTRAP_FAILED", diagnostic: null, bootstrap: { mapVersion: BOOTSTRAP_CHECKPOINT_MAP_VERSION, checkpoint, exitCode } },
    })
    expect(verifyBoundOwnership(bound, { launchManifest, launchReceipt }).valid).toBe(true)
  })

  it("keeps secure-directory creation and ACL verification distinct", () => {
    expect(BOOTSTRAP_CHECKPOINT_EXIT_CODES.BOOTSTRAP_SECURE_SOURCE_DIRECTORY_CREATE).not.toBe(BOOTSTRAP_CHECKPOINT_EXIT_CODES.BOOTSTRAP_SECURE_SOURCE_DIRECTORY_ACL_VERIFY)
    const collector = fs.readFileSync(collectorPath, "utf8")
    expect(collector).toMatch(/BOOTSTRAP_SECURE_SOURCE_DIRECTORY_CREATE'[\s\S]*?New-ElevatedSourceDirectory/)
    expect(collector).toMatch(/BOOTSTRAP_SECURE_SOURCE_DIRECTORY_ACL_VERIFY'[\s\S]*?Assert-ElevatedSourceDirectoryAcl/)
  })

  it("binds unknown exits as unknown and never guesses a checkpoint", () => {
    const launchManifest = manifest()
    const launchReceipt = receipt(199, null)
    const bound = bindOwnershipOutcome({ launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    expect(bound).toMatchObject({ schema: BOUND_SCHEMA, currentTruthClaim: false, failure: { disposition: "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL_UNKNOWN", bootstrap: { checkpoint: null, exitCode: 199 } } })
    expect(JSON.stringify(bound)).not.toMatch(/Authorization|Bearer|secret-must-not-cross/)
    expect(verifyBoundOwnership(bound, { launchManifest, launchReceipt }).valid).toBe(true)
  })

  it("rejects tampered checkpoint mappings, receipts, and bound bootstrap facts", () => {
    const launchManifest = manifest()
    const exitCode = BOOTSTRAP_CHECKPOINT_EXIT_CODES.BOOTSTRAP_MANIFEST_PARSE
    const launchReceipt = receipt(exitCode, "BOOTSTRAP_MANIFEST_PARSE")
    expect(() => bindOwnershipOutcome({ launchManifest, launchReceipt: { ...launchReceipt, bootstrapCheckpoint: "BOOTSTRAP_DOCKER_DIGEST" }, now: new Date("2026-08-28T12:00:05.000Z") })).toThrow(/checkpoint mapping/i)
    expect(() => bindOwnershipOutcome({ launchManifest, launchReceipt: { ...launchReceipt, bootstrapMapVersion: "attacker-map/9" }, now: new Date("2026-08-28T12:00:05.000Z") })).toThrow(/bootstrap exit lineage/i)
    const bound = bindOwnershipOutcome({ launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    const tampered = structuredClone(bound)
    tampered.failure.bootstrap.checkpoint = "BOOTSTRAP_DOCKER_DIGEST"
    expect(() => verifyBoundOwnership(tampered, { launchManifest, launchReceipt })).toThrow(/BOUND_TAMPERED/)
  })

  it("continues to verify historical schema-1 cause-less receipts without rewriting them", () => {
    const launchManifest = manifest()
    const launchReceipt = receipt(1, null, "hermes-ollama-ownership-launch-receipt/1")
    const bound = bindOwnershipOutcome({ launchManifest, launchReceipt, now: new Date("2026-08-28T12:00:05.000Z") })
    expect(bound).toMatchObject({ schema: LEGACY_BOUND_SCHEMA, failure: { disposition: "COLLECTOR_DIED_BEFORE_DIAGNOSTIC_SEAL", diagnostic: null } })
    expect(verifyBoundOwnership(bound, { launchManifest, launchReceipt }).valid).toBe(true)
  })

  it("keeps one UAC launch, no retry, and no HERMES mutation primitive", () => {
    const collector = fs.readFileSync(collectorPath, "utf8")
    const stager = fs.readFileSync(stagerPath, "utf8")
    expect(stager.match(/^\s*\$elevated\s*=\s*Start-Process/gm)).toHaveLength(1)
    expect(stager.match(/-Verb RunAs/g)).toHaveLength(1)
    expect(stager).not.toMatch(/while\s*\(|do\s*\{|for\s*\([^)]*Start-Process/i)
    expect(collector).not.toMatch(/^\s*(?:Set-(?!StrictMode)|Remove-|Clear-|Enable-|Disable-|Start-|Stop-|Restart-|Register-|Unregister-|Mount-|Dismount-|Initialize-|Format-|Resize-|Repair-|Update-)[A-Za-z]/m)
    expect(collector).not.toMatch(/\b&?\s*\$dockerExe\s+(?:run|start|stop|restart|rm|rmi|pull|build)\b/i)
  })
})
