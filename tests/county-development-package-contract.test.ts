import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(process.cwd())
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("County Development package contract", () => {
  it("keeps the HERMES Cockpit origin unchanged and defines a distinct loopback build", () => {
    const hermes = JSON.parse(read("cockpit/cockpit.config.json"))
    const county = JSON.parse(read("cockpit/county-development.config.json"))
    const countyTauri = JSON.parse(read("cockpit/src-tauri/tauri.county-development.conf.json"))

    expect(hermes.hermesOrigin).toBe("https://192.168.88.9:3443")
    expect(county).toMatchObject({
      deploymentProfile: "county-development",
      serviceOrigin: "http://127.0.0.1:3200",
      startupPath: "/device-bootstrap",
    })
    expect(JSON.stringify(county)).not.toContain("192.168.88.9")
    expect(countyTauri.identifier).toBe("com.williamos.cockpit.county-development")
    expect(countyTauri.app.security.csp).toContain("navigate-to http://127.0.0.1:3200")
  })

  it("packages a user-token runtime without host security mutation", () => {
    const manager = read("deploy/county-development/Manage-WilliamOSCountyDevelopment.ps1")
    const forbiddenCommands = [
      "New-NetFirewallRule",
      "Set-NetFirewallProfile",
      "New-Service",
      "sc.exe create",
      "schtasks.exe /Create",
      "wsl.exe --install",
      "docker.exe",
      "netsh advfirewall",
    ]
    for (const command of forbiddenCommands) expect(manager).not.toContain(command)

    expect(manager).toContain('$env:HOSTNAME = "127.0.0.1"')
    expect(manager).toContain('$env:WILLIAMOS_DEPLOYMENT_PROFILE = "county-development"')
    expect(manager).toContain("COUNTY_DEVELOPMENT_REMOTE_PROVIDER_SECRET_FORBIDDEN")
    expect(manager).toContain("PACKAGE_HASH_MISMATCH")
    expect(manager).toContain("LOCAL_MODEL_NOT_INSTALLED")
  })

  it("builds source-pinned application and model artifacts on Windows", () => {
    const workflow = read(".github/workflows/county-development-bundle.yml")
    const builder = read("scripts/build-county-development-bundle.ps1")
    const acceptance = read("scripts/accept-county-development-runtime.cjs")

    expect(workflow).toContain("pull_request:")
    expect(workflow).toContain("push:")
    expect(workflow).toContain("runs-on: windows-2022")
    expect(workflow).toContain("qwen2.5-coder:1.5b")
    expect(workflow).toContain("snowflake-arctic-embed2")
    expect(workflow).toContain("pgvector/pgvector")
    expect(workflow).toContain("Run installed County owner-surface acceptance")
    expect(workflow).toContain("Exercise the County Cockpit native surface")
    expect(workflow).toContain("accept-county-development-runtime.cjs")
    expect(builder).toContain("williamos.county-development.bundle.v1")
    expect(builder).toContain("sourceSha = $SourceSha")
    expect(builder).toContain("Get-FileHash")
    expect(builder).toContain("build_azure_standalone_artifact.ps1")
    expect(builder).toContain('foreach ($directory in @("bin", "lib", "share"))')
    expect(builder).toContain("PORTABLE_POSTGRES_DATA_REFUSED")
    expect(builder).not.toContain('Copy-Tree $PostgresRoot (Join-Path $stageRoot "runtime\\postgres")')
    expect(acceptance).toContain("REAL_FILE_EDIT_SAVED")
    expect(acceptance).toContain("LOCAL_ASSISTANT_RESPONDED")
    expect(acceptance).toContain("CONVERSATION_RESTORED")
  })
})
