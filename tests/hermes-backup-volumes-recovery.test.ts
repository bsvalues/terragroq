import fs from "node:fs"

import { describe, expect, it } from "vitest"

const source = fs.readFileSync("scripts/lab-control/hermes/backup-volumes.ps1", "utf8")

describe("HERMES recovery generation producer", () => {
  it("keeps the labelled archive volume as the only local destination authority", () => {
    expect(source).toContain("Resolve-ArchiveRoot -Label $ArchiveVolumeLabel")
    expect(source).toContain('lab-backups\\hermes-volumes')
    expect(source).not.toContain('F:\\lab-backups')
  })

  it("emits a bounded appliance config archive into the existing cross-node *.tar.gz stream", () => {
    expect(source).toContain('hermes-appliance-config-$stamp.tar.gz')
    expect(source).toContain("$requiredConfig")
    expect(source).toContain("$optionalConfig")
    expect(source).toContain("hermes/backup-volumes.ps1")
    expect(source).toContain("hermes/docker-compose.yml")
    expect(source).toContain("hermes/p40-guard.ps1")
    expect(source).toContain("hermes\\ollama-service")
    expect(source).toContain("hermes-recovery-config-inventory/1")
    expect(source).toContain("RECOVERY_ALLOWLIST_UNSAFE")
    expect(source).toContain("RECOVERY_CONFIG_REPARSE_POINT")
    expect(source).toContain("RECOVERY_CONFIG_PATH_ESCAPE")
    expect(source).not.toContain("GetRelativePath")
    expect(source).not.toContain("'-C', $HermesLabRoot")
    expect(source).not.toContain("'--exclude=node_modules'")
    expect(source).toContain("RECOVERY_TAR_FAILED")
  })

  it("never admits live secrets, logs, backup copies, or runtime trees into the config archive", () => {
    expect(source).toContain(".env")
    expect(source).toContain(".log")
    expect(source).toContain(".bak")
    expect(source).not.toContain("williamos-runtime-")
    expect(source).not.toContain("release-staging")
    expect(source).not.toContain("node_modules")
  })

  it("seals a canary and cryptographic artifact manifest into the same transport generation", () => {
    expect(source).toContain("hermes-recovery-generation/1")
    expect(source).toContain("HERMES_RECOVERY_CANARY")
    expect(source).toContain("Get-FileHash -Algorithm SHA256")
    expect(source).toContain('hermes-recovery-proof-$stamp.tar.gz')
    expect(source).toContain("recovery-manifest.json")
    expect(source).toContain("RECOVERY_MANIFEST_ROUNDTRIP_FAILED")
  })

  it("fails the scheduled producer instead of pruning around a bad current generation", () => {
    expect(source).toContain('if ($failed.Count -eq 0 -and $old.Count -gt 0)')
    expect(source).toContain('if ($failed.Count -gt 0)')
    expect(source).toContain('exit 1')
    expect(source).toContain('HERMES_RECOVERY_GENERATION_READY')
    expect(source).toContain('BACKUP_DONE')
  })

  it("keeps the proof staging directory outside the protected repository and removes it", () => {
    expect(source).toContain('$stage = Join-Path $env:TEMP')
    expect(source).toContain('Remove-Item -LiteralPath $stage -Recurse -Force')
    expect(source).not.toContain('New-Item -ItemType File -Path $HermesLabRoot')
  })
})
