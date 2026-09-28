import fs from "node:fs"

import { describe, expect, it } from "vitest"

const read = (name: string) => fs.readFileSync(`scripts/lab-control/hermes/${name}`, "utf8")

describe("HERMES appliance source convergence", () => {
  it("derives the protected model store from the canonical Ollama service", () => {
    const source = read("sync-models-to-forge.ps1")
    expect(source).toContain("function Resolve-LiveStore")
    expect(source).toContain("$liveStore = Resolve-LiveStore -ServiceScript $ServiceScript")
    expect(source).toContain("$store = $liveStore.Store")
    expect(source).not.toMatch(/\$store\s*=\s*["']D:\\HermesData\\ollama["']/)
  })

  it("makes model replication part of native and Console protection truth", () => {
    expect(read("lab-health.ps1")).toContain('HermesModelForgeSync')
    const collector = read("console/collect-hermes-console-status.ps1")
    expect(collector).toContain("$modelSyncTask = Get-TaskFact 'HermesModelForgeSync'")
    expect(collector).toContain("$modelSyncTask.result -eq 0")
    expect(collector).toContain("Fact 'Model replica task'")
    expect(collector).toContain("$p40CountersPresent")
    expect(collector).toContain("Fact 'P40 ECC telemetry'")
  })

  it("separates doctrine noise from real listener exposure and refuses broad RDP", () => {
    const collector = read("console/collect-hermes-console-status.ps1")
    expect(collector).toContain("$exposureDrift")
    expect(collector).toContain("$exposureCount -gt 0")
    expect(collector).toContain("$broadRdpRules.Count -gt 0")
    expect(collector).toContain("ActiveStore")
    expect(collector).toContain("$firewallRuleProbeSucceeded")
    expect(collector).toContain("broad Remote Desktop allow rules enabled")
    expect(collector).not.toContain("-or $ingressCount -gt 0){'CRITICAL'}")
  })

  it("treats D as rollback rather than the active appliance data store", () => {
    const collector = read("console/collect-hermes-console-status.ps1")
    expect(collector).toContain("Fact 'D: legacy rollback'")
    expect(collector).not.toContain("Fact 'D: appliance data'")
    expect(collector).toContain("$LegacyDockerVhdxPath")
    expect(collector).toContain("$legacyDockerBindingAvailable")
    expect(collector).not.toContain("Get-Item -LiteralPath 'C:\\Users\\bs\\AppData\\Local\\Docker\\wsl\\disk\\docker_data.vhdx'")
  })

  it("keeps Appliance V1 alerts native-only", () => {
    for (const file of ["lab-health.ps1", "morning-report.ps1", "send-hermes-alert.ps1"]) {
      const source = read(file)
      expect(source).not.toContain("HERMES_NTFY_TOPIC")
      expect(source).not.toContain("ntfy.sh")
    }
    expect(read("send-hermes-alert.ps1")).toContain("HERMES_NATIVE_ALERT_RECORDED")
    expect(read("lab-health.ps1")).toContain("$null -ne $previousOverall -or $Overall -ne 'ok'")
    expect(read("lab-health.ps1")).toContain("'RECOVERY'")
    expect(read("morning-report.ps1")).not.toContain("send-hermes-alert.ps1")
    expect(read("console/lib/status-contract.mjs")).toContain('"RECOVERY"')
  })

  it("uses real generation artifacts for backup freshness", () => {
    const source = read("morning-report.ps1")
    expect(source).toContain("hermes-recovery-proof-*.tar.gz")
    expect(source).toContain("Get-ChildItem 'G:\\lab-backups\\hermes-volumes' -Filter 'hermes-recovery-proof-*.tar.gz' -File -ErrorAction Stop")
    expect(source).toContain("'^\\d{8}_\\d{6}$'")
    expect(source).not.toContain("Get-ChildItem 'G:\\lab-backups\\hermes-volumes' -ErrorAction Stop")
  })

  it("fails immediately when a native Docker Compose command fails", () => {
    const source = read("start-hermes.ps1")
    expect(source).toContain("function Invoke-DockerComposeChecked")
    expect(source).toContain("$ErrorActionPreference = 'Continue'")
    for (const code of ["DOCKER_COMPOSE_PULL_FAILED", "DOCKER_COMPOSE_UP_FAILED", "DOCKER_COMPOSE_STATUS_FAILED"]) {
      expect(source).toContain(code)
    }
  })

  it("applies changed Compose configuration and keeps rollback bytes in a protected root", () => {
    const source = read("deploy-hermes-appliance.ps1")
    expect(source).toContain("$composeChanged")
    expect(source).toContain("Invoke-Compose 'validate'")
    expect(source).toContain("Invoke-Compose 'apply'")
    expect(source).toContain("DOCKER_COMPOSE_SERVICES_MISSING")
    expect(source).toContain("compose-image-pins.json")
    expect(source).toContain("DOCKER_COMPOSE_IMAGE_DRIFT")
    expect(source).toContain("Assert-ComposeImages")
    expect(source).toContain("C:\\ProgramData\\Hermes\\release-rollback")
    expect(source).toContain("hermes-appliance-release/2")
    expect(source).toContain("$acl.SetAccessRuleProtection($true,$false)")
    expect(source).toContain("ROLLBACK_SOURCE_HASH_MISMATCH")
    expect(source).toContain("STAGED_SOURCE_HASH_MISMATCH")
    expect(source).toContain("STAGED_PAYLOAD_HASH_MISMATCH")
    expect(source).toContain("Copy-Item -LiteralPath $entry.staged -Destination $entry.target -Force")
    expect(source).not.toContain("Copy-Item -LiteralPath $entry.source -Destination $entry.target -Force")
    expect(source).not.toContain("$evidenceReceiptPath")
    expect(source).not.toContain("$EvidenceRoot")
    expect(source).not.toContain("Copy-Item -LiteralPath $entry.backup -Destination $entry.target -Force}")
    expect(source).toContain("C:\\ProgramData\\Hermes\\runtime")
    expect(source).toContain("$privilegedTaskScripts")
    expect(source).toContain("Export-ScheduledTask")
    expect(source).toContain("Set-ScheduledTask -TaskName $taskEntry.name -Action $taskEntry.newAction")
    expect(source).toContain("Register-ScheduledTask -TaskName $taskEntry.name -Xml")
    expect(source).toContain("deployedXmlSha256")
    expect(source).toContain("UNEXPECTED_CONSOLE_TASK_ACTION")
    expect(source).toContain("UNEXPECTED_COLLECTOR_TASK_ACTION")
    expect(source).toContain("NATIVE_HEALTH_FAILED")
    expect(source).toContain("SetSecurityDescriptorSddlForm")
    expect(source).toContain("ROLLBACK_PROTECTED_DIRECTORY_SCOPE_REFUSED")
    expect(source).toContain("historicalTrust='LEGACY_USER_WRITABLE'")
    expect(source).toContain("LEGACY_STATE_IMPORT_HASH_MISMATCH")
    for (const diagnostic of ["collect-hermes-host-attestation.v1.ps1", "bind-hermes-host-attestation.v1.mjs", "stage-hermes-host-attestation.v1.ps1", "diagnose-hermes-ollama-ownership.ps1", "bind-hermes-ollama-ownership.v1.mjs", "stage-hermes-ollama-ownership.v1.ps1"]) {
      expect(source).toContain(diagnostic)
    }
  })

  it("keeps privileged runtime and authoritative health state outside user-writable HermesLab", () => {
    expect(read("lab-health.ps1")).toContain("C:\\ProgramData\\Hermes\\health")
    expect(read("p40-guard.ps1")).toContain("C:\\ProgramData\\Hermes\\p40")
    expect(read("console/collect-hermes-console-status.ps1")).toContain("C:\\ProgramData\\Hermes\\health\\lab-health.json")
    expect(read("doctrine/run-hermes-doctrine.ps1")).toContain("C:\\Program Files\\nodejs\\node.exe")
    expect(read("doctrine/run-hermes-doctrine.ps1")).not.toContain("AppData\\Local\\hermes\\node\\node.exe")
    expect(read("ollama-service/install-hermes-ollama-service.ps1")).toContain("C:\\ProgramData\\Hermes\\runtime\\ollama-service\\hermes-ollama-service.ps1")
  })

  it("backs up every current core Compose volume and every deployed recovery script", () => {
    const source = read("backup-volumes.ps1")
    for (const volume of ["hermes_pgdata", "hermes_redisdata", "hermes_webuidata", "hermes_portainerdata"]) {
      expect(source).toContain(`"${volume}"`)
    }
    for (const file of ["deploy-hermes-appliance.ps1", "morning-report.ps1", "send-hermes-alert.ps1", "terrafusion-report.ps1", "verify-durability-after-reboot.ps1"]) {
      expect(source).toContain(`'hermes/${file}'`)
    }
    expect(source).toContain("Copy-ProtectedTaskDefinition")
    expect(source).toContain("RECOVERY_DEPLOYED_RELEASE_ABSENT")
    expect(source).toContain("RECOVERY_DEPLOYMENT_TRANSACTION_UNRESOLVED")
    expect(source).toContain("deployedXmlSha256")
    expect(source).toContain("'hermes\\host-attestation'")
    expect(source).toContain("Copy-ProtectedRecoveryFile")
    expect(source).toContain("protected-state/doctrine/doctrine.json")
    expect(source).toContain("protected-state/health/alerts.log")
  })

  it("has one current acceptance suite and reuses it after reboot", () => {
    const acceptance = read("hermes-acceptance.ps1")
    const durability = read("verify-durability-after-reboot.ps1")
    expect(acceptance).not.toContain("RETIRED_ACCEPTANCE")
    expect(acceptance).toContain("HERMES_APPLIANCE_V1_ACCEPTED")
    expect(acceptance).toContain("HERMES_APPLIANCE_V1_NOT_ACCEPTED")
    expect(acceptance).toContain("'appliance','inference','protection','storage','security','doctrine','workbench'")
    expect(acceptance).toContain('Add-Check "domain-$domain"')
    expect(acceptance).toContain("golden-model-generation")
    expect(acceptance).toContain("p40-active-under-generation")
    expect(acceptance).toContain("peakUtilization")
    expect(acceptance).toContain("function Has-Properties")
    expect(durability).toContain("& $suite -RequirePostDeploymentReboot")
    expect(durability).toContain("HERMES_ACCEPTANCE_SUITE_NO_VERDICT")
    expect(durability).not.toContain("ollama-watchdog")
  })

  it("fails closed on missing GPU telemetry and malformed catalogue entries", () => {
    const guard = read("p40-guard.ps1")
    expect(guard).toContain("$throttleTelemetryPresent")
    expect(guard).toContain("P40 thermal slowdown telemetry unavailable")
    expect(guard).toContain("$f.Count -lt 3")
    expect(read("ollama-service/hermes-ollama-service.ps1")).toContain("$tags.models | Where-Object { $null -ne $_ }")
  })

  it("removes downloaded restore archives while retaining extracted evidence", () => {
    const source = read("verify-offhost-restore.ps1")
    expect(source).toContain("foreach($downloadName in @($latest.Name,$configName))")
    expect(source).toContain("if(-not $completed")
  })
})
