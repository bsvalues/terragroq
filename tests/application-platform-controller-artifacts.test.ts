import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const builderPath = process.env.WILLIAMOS_TASK5_BUILDER?.trim()
const deployerPath = process.env.WILLIAMOS_TASK5_DEPLOYER?.trim()
const controllerArtifacts = builderPath && deployerPath ? describe : describe.skip

const trustedAssets = [
  "config/application-runtime/static-web-v1.policy.json",
  "config/execution-fabric/hermes-free-dev-agent-v2.policy.json",
  "scripts/application-runtime/Dockerfile",
  "scripts/application-runtime/server.mjs",
  "scripts/application-runtime/read-preview.mjs",
  "scripts/execution-fabric/hermes-agent/invoke-hermes-free-dev-agent.ps1",
  "starters/static-web-v1/.williamos/application.json",
  "starters/static-web-v1/src/index.html",
  "starters/static-web-v1/src/styles.css",
  "starters/static-web-v1/src/app.js",
  "starters/static-web-v1/test/application.test.mjs",
] as const

function functionBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start + 1)
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0)
  expect(end, `${nextName} must follow ${name}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

controllerArtifacts("Task 5 controller artifact contracts", () => {
  it("packages the complete application and Hello test surface plus the exact trusted assets", () => {
    expect(fs.existsSync(builderPath!), "versioned v3 builder must exist").toBe(true)
    const builder = fs.readFileSync(builderPath!, "utf8")
    expect(builder).toContain("Get-ApplicationTestPaths")
    expect(builder).toContain("HELLO_ARTIFACT_APPLICATION_TESTS_FAILED")
    for (const asset of trustedAssets) expect(builder).toContain(asset.replaceAll("/", "\\"))
    expect(builder).toContain("HELLO_ARTIFACT_TRUSTED_ASSET_MISMATCH")
  })

  it("keeps current-action preflight byte-compatible and adds topology only to new actions", () => {
    expect(fs.existsSync(deployerPath!), "versioned v4 deployer must exist").toBe(true)
    const deployer = fs.readFileSync(deployerPath!, "utf8")
    const currentAction = functionBody(deployer, "Get-HelloTaskActionRecordForRoot", "Assert-TaskContract")
    const newAction = functionBody(deployer, "New-HelloTaskActions", "Test-ActionEquals")
    for (const argument of ["--applications-root=", "--application-runtime-root=", "--application-asset-root=", "--application-deployment-root="]) {
      expect(currentAction).not.toContain(argument)
      expect(newAction).toContain(argument)
    }
    expect(newAction).toContain("--application-runtime-root=$(Get-FullPath $BridgeRoot)")
  })

  it("protects durable roots and verifies exact source-owned payload bytes, syntax and evidence", () => {
    expect(fs.existsSync(deployerPath!), "versioned v4 deployer must exist").toBe(true)
    const deployer = fs.readFileSync(deployerPath!, "utf8")
    const bridgeAcl = functionBody(deployer, "Assert-BridgeRootAclSafe", "Ensure-DurableApplicationsRoot")
    expect(deployer).toContain("$ApplicationsRoot = Join-Path $InstallParent 'applications'")
    expect(deployer).toContain("applicationRuntimeRoot = Get-FullPath $BridgeRoot")
    expect(deployer).toContain("applicationsRootAcl")
    expect(deployer).toContain("bridgeRootAcl")
    expect(deployer).toContain("TrustedApplicationAssets")
    expect(deployer).toContain("trustedApplicationAssetDigests")
    expect(deployer).toContain("HELLO_APPLICATION_ASSET_SOURCE_MISMATCH")
    expect(deployer).toContain("HELLO_APPLICATION_ASSET_CHECK_FAILED")
    expect(deployer).toContain("HELLO_APPLICATION_INVOKER_CHECK_FAILED")
    expect(deployer).toContain("SetAccessRuleProtection($true, $false)")
    for (const sid of ["S-1-5-18", "S-1-5-32-544", "S-1-1-0", "S-1-5-11", "S-1-5-32-545"]) expect(deployer).toContain(sid)
    expect(deployer).toContain("HELLO_BRIDGE_ROOT_ACL_BROAD_WRITE")
    expect(deployer).toContain("HELLO_BRIDGE_ROOT_ACL_UNTRUSTED_WRITER")
    expect(deployer).toContain("HELLO_BRIDGE_ROOT_ACL_TASK_ACCESS_DENIED")
    expect(deployer).toContain("PropagationFlags]::InheritOnly")
    expect(deployer).toContain("$trustedWriterSids")
    expect(bridgeAcl).toContain("$rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny) {")
    expect(bridgeAcl).not.toMatch(/AccessControlType\]::Deny\s+-and\s+\$rule\.IdentityReference/)
    expect(deployer).toContain("durableRootsAfterStage")
    expect(deployer).toContain("durableRootsAfterCutover")
    expect(deployer).toContain("durableRootsPreserved")
    for (const asset of trustedAssets) expect(deployer).toContain(asset.replaceAll("/", "\\"))
    for (const cerebrasHelper of ["invoke-cerebras-hello-change.ps1", "cerebras-credential-manager.ps1", "test-cerebras-credential-ready.ps1", "cerebras-hello-change.mjs", "external-model-api.mjs"]) expect(deployer).toContain(cerebrasHelper)
    expect(deployer).not.toMatch(/Remove-Item[^\r\n]*(?:ApplicationsRoot|BridgeRoot)/i)
  })

  it("keeps real Focus Board acceptance explicit, serial, authenticated and free of route mocks", () => {
    const spec = fs.readFileSync(path.resolve("tests/browser/application-platform-live.spec.ts"), "utf8")
    expect(spec).toContain("test.describe.serial")
    expect(spec).toContain("WILLIAMOS_LIVE_APPLICATION_ACCEPTANCE")
    expect(spec).toContain("WILLIAMOS_LIVE_APPLICATION_ORIGIN")
    expect(spec).toContain("WILLIAMOS_E2E_STORAGE_STATE")
    expect(spec).toContain("WILLIAMOS_LIVE_EXPECTED_FINAL_SHA")
    expect(spec).toContain("record(truth.runtimeBuild).sha")
    expect(spec).toContain('getByLabel("Focus Board runtime truth")')
    expect(spec).toContain("expectedFinalSha")
    expect(spec).toContain("2_100_000")
    expect(spec).toContain("providerExecution: null")
    expect(spec).not.toContain("page.route(")
    expect(spec).not.toContain("route.fulfill(")
  })
})
