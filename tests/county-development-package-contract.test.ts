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
    const countyCapability = JSON.parse(read("cockpit/src-tauri/capabilities/county-development-cockpit.json"))

    expect(hermes.hermesOrigin).toBe("https://192.168.88.9:3443")
    expect(county).toMatchObject({
      deploymentProfile: "county-development",
      serviceOrigin: "http://127.0.0.1:3200",
      startupPath: "/device-bootstrap",
    })
    expect(JSON.stringify(county)).not.toContain("192.168.88.9")
    expect(countyTauri.identifier).toBe("com.williamos.cockpit.county-development")
    expect(countyTauri.app.security.capabilities).toEqual(["county-development-cockpit"])
    expect(countyTauri.app.security.csp).toContain("navigate-to http://127.0.0.1:3200")
    expect(countyCapability).toMatchObject({
      identifier: "county-development-cockpit",
      windows: ["main"],
      remote: { urls: ["http://127.0.0.1:3200/*"] },
    })
    expect(countyCapability.permissions).toEqual(expect.arrayContaining([
      "allow-device-generate-key",
      "allow-device-bind-credential",
      "allow-device-credential",
      "allow-device-sign",
    ]))
  })

  it("packages a user-token runtime without host security mutation", () => {
    const manager = read("deploy/county-development/Manage-WilliamOSCountyDevelopment.ps1")
    const launcher = read("deploy/county-development/WilliamOS-County-Development.cmd")
    const example = JSON.parse(read("deploy/county-development/county-development.config.example.json"))
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

    expect(launcher).toContain("deploy\\county-development\\Manage-WilliamOSCountyDevelopment.ps1")
    expect(launcher).not.toContain('"%~dp0Manage-WilliamOSCountyDevelopment.ps1"')
    expect(manager).toContain('$env:HOSTNAME = "127.0.0.1"')
    expect(manager).toContain('$env:WILLIAMOS_DEPLOYMENT_PROFILE = "county-development"')
    expect(manager).toContain("COUNTY_DEVELOPMENT_REMOTE_PROVIDER_SECRET_FORBIDDEN")
    expect(manager).toContain("PACKAGE_HASH_MISMATCH")
    expect(manager).toContain("LOCAL_MODEL_NOT_INSTALLED")
    expect(manager).toContain("[Security.Cryptography.RandomNumberGenerator]::Create()")
    expect(manager).toContain("$rng.GetBytes($buffer)")
    expect(manager).not.toContain("RandomNumberGenerator]::Fill")
    expect(manager).toContain("function Normalize-OllamaModelName")
    expect(manager).toContain("Get-CimInstance -ClassName Win32_Process")
    expect(manager).toContain("STALE_PID_DISCARDED")
    expect(manager).toContain('[string]$PreviewUrl')
    expect(manager).toContain('http://127.0.0.1:3102/')
    expect(manager).toContain("PREVIEW_URL_INVALID")
    expect(manager).toContain("$uri.UserInfo")
    expect(manager).toContain("$uri.Query")
    expect(manager).toContain("[UriBuilder]$preview")
    expect(example.previewUrl).toBe("http://127.0.0.1:3102/")
  })

  it("builds source-pinned artifacts and accepts the complete owner journey on Windows", () => {
    const workflow = read(".github/workflows/county-development-bundle.yml")
    const builder = read("scripts/build-county-development-bundle.ps1")
    const acceptance = read("scripts/accept-county-development-runtime.cjs")
    const health = read("app/api/health/route.ts")

    expect(workflow).toContain("pull_request:")
    expect(workflow).toContain("push:")
    expect(workflow).toContain("runs-on: windows-2022")
    expect(workflow).toContain("qwen2.5-coder:1.5b")
    expect(workflow).toContain("snowflake-arctic-embed2")
    expect(workflow).toContain("pgvector/pgvector")
    expect(workflow).toContain("Run installed County owner-surface acceptance")
    expect(workflow).toContain("Exercise the installed County Cockpit relaunch path")
    expect(workflow).toContain("accept-county-development-runtime.cjs")
    expect(workflow).toContain("$packageRoot = $package")
    expect(workflow).not.toContain("$packageRoot = Get-ChildItem $package -Directory")
    expect(workflow).toContain("git clone --depth 1 --filter=blob:none --sparse https://github.com/bsvalues/terrafusion_os_1.0.git")
    expect(workflow).toContain("COUNTY_SMOKE_TF_SHA")
    expect(workflow).toContain("-Action Launch -InstallRoot $env:COUNTY_SMOKE_INSTALL")
    expect(workflow).toContain("installed-manager-after-owner-enrollment")
    expect(workflow).toContain("launches = @($first, $second)")
    expect(workflow).toContain("did not expose a native main window through the installed Launch lifecycle")

    expect(builder).toContain("williamos.county-development.bundle.v1")
    expect(builder).toContain("sourceSha = $SourceSha")
    expect(builder).toContain("Get-FileHash")
    expect(builder).toContain("build_azure_standalone_artifact.ps1")
    expect(builder).toContain('foreach ($directory in @("bin", "lib", "share"))')
    expect(builder).toContain("PORTABLE_POSTGRES_DATA_REFUSED")
    expect(builder).not.toContain('Copy-Tree $PostgresRoot (Join-Path $stageRoot "runtime\\postgres")')

    expect(acceptance).toContain("REAL_SOURCE_PINNED_TERRAFUSION_WORKSPACE_OPENED")
    expect(acceptance).toContain("rootFileButton")
    expect(acceptance).toContain('aria-label$=" entries"')
    expect(acceptance).toContain("workspaceTreeFromRootFile")
    expect(acceptance).toContain("EDIT_UNDO_REDO_VERIFIED")
    expect(acceptance).toContain("REAL_FILE_EDIT_SAVED")
    expect(acceptance).toContain("SECOND_REAL_FILE_OPENED")
    expect(acceptance).toContain("TWO_REAL_FILES_PLACED_SIDE_BY_SIDE")
    expect(acceptance).toContain("BOUNDED_PROJECT_OPERATION_EXECUTED")
    expect(acceptance).toContain("DEGRADED_DEVELOPER_PREVIEW_FIXTURE_INTERACTIVE")
    expect(acceptance).toContain("LOCAL_ASSISTANT_RESPONDED")
    expect(acceptance).toContain("assert.match(responseText, /COUNTY_LOCAL_OK/)")
    expect(acceptance).toContain("OWNER_SURFACE_CLOSED")
    expect(acceptance).toContain("OWNER_SURFACE_REOPENED")
    expect(acceptance).toContain("SPACE_FILES_SPLIT_PREVIEW_AND_CONVERSATION_RESTORED")
    expect(acceptance).toContain('page.on("websocket"')
    expect(acceptance).toContain("externalWebSockets")
    expect(acceptance).toContain("no TerraFusion business acceptance is claimed")

    expect(health).toContain("liveRuntime.model === runtime.chatModel")
    expect(health).toContain("exactCountyChatModelReady")
    expect(health).toContain("exactCountyEmbeddingModelReady")
  })
})
