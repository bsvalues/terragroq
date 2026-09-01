import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const cockpit = path.join(root, "cockpit")
const toolchain = fs.readFileSync(path.join(cockpit, "rust-toolchain.toml"), "utf8")
const packageJson = JSON.parse(fs.readFileSync(path.join(cockpit, "package.json"), "utf8"))
const stage = fs.readFileSync(path.join(cockpit, "scripts", "stage-webview2-loader.ps1"), "utf8")
const invoke = fs.readFileSync(path.join(cockpit, "scripts", "invoke-native.ps1"), "utf8")
const cargoLock = fs.readFileSync(path.join(cockpit, "src-tauri", "Cargo.lock"), "utf8")

describe("the reproducible WilliamOS Cockpit native build", () => {
  it("pins the documented Windows GNU compiler instead of inheriting a machine default", () => {
    expect(toolchain).toContain('channel = "1.88.0-x86_64-pc-windows-gnu"')
  })

  it("stages the loader before native tests and both Tauri entry points", () => {
    expect(packageJson.scripts["native:test"]).toContain("invoke-native.ps1 test")
    expect(packageJson.scripts["tauri:dev"]).toContain("invoke-native.ps1 dev")
    expect(packageJson.scripts["tauri:build"]).toContain("invoke-native.ps1 build")
    expect(invoke.indexOf("stage-webview2-loader.ps1")).toBeLessThan(invoke.indexOf("cargo test"))
    expect(invoke).toContain('@("--bundles", "msi,nsis")')
  })

  it("fetches the locked Cargo graph before staging on a fresh checkout", () => {
    const fetchIndex = invoke.indexOf("cargo fetch")
    const stageIndex = invoke.indexOf("stage-webview2-loader.ps1")
    expect(fetchIndex).toBeGreaterThan(-1)
    expect(fetchIndex).toBeLessThan(stageIndex)
    expect(invoke).toMatch(/cargo fetch --manifest-path \$manifest --locked/)
    expect(invoke).toMatch(/if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/)
  })

  it("provides the already-installed MinGW dlltool to cargo and every dependency", () => {
    expect(invoke).toContain('C:\\msys64\\mingw64\\bin')
    expect(invoke).toContain('Join-Path $mingwBin "dlltool.exe"')
    expect(invoke).toMatch(/\$env:PATH\s*=\s*"\$mingwBin;/)
  })

  it("takes the x64 loader only from the exact crate version pinned in Cargo.lock", () => {
    expect(cargoLock).toMatch(/name = "webview2-com-sys"\r?\nversion = "0\.38\.2"/)
    expect(stage).toContain("webview2-com-sys-0.38.2\\x64\\WebView2Loader.dll")
    expect(stage).toContain("System.Security.Cryptography.SHA256")
    expect(stage).toContain("different bytes")
  })
})
