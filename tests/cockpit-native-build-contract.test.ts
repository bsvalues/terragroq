import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const cockpit = path.join(root, "cockpit")
const toolchain = fs.readFileSync(path.join(cockpit, "rust-toolchain.toml"), "utf8")
const packageJson = JSON.parse(fs.readFileSync(path.join(cockpit, "package.json"), "utf8"))
const stage = fs.readFileSync(path.join(cockpit, "scripts", "stage-webview2-loader.ps1"), "utf8")
const invoke = fs.readFileSync(path.join(cockpit, "scripts", "invoke-native.ps1"), "utf8")
const buildScript = fs.readFileSync(path.join(cockpit, "src-tauri", "build.rs"), "utf8")
const cargoLock = fs.readFileSync(path.join(cockpit, "src-tauri", "Cargo.lock"), "utf8")

describe("the reproducible WilliamOS Cockpit native build", () => {
  it("uses valid channel metadata and explicitly activates the pinned Windows GNU host", () => {
    expect(toolchain).toContain('channel = "1.88.0"')
    expect(toolchain).not.toContain('channel = "1.88.0-x86_64-pc-windows-gnu"')
    expect(invoke).toContain('$pinnedToolchain = "1.88.0-x86_64-pc-windows-gnu"')
    expect(invoke).toContain("toolchain install $pinnedToolchain --profile minimal")
    expect(invoke).toContain("$env:RUSTUP_TOOLCHAIN = $pinnedToolchain")
    expect(invoke).toContain('host: x86_64-pc-windows-gnu')
  })

  it("stages the loader before native tests and both Tauri entry points", () => {
    expect(packageJson.scripts["native:stage"]).toContain("invoke-native.ps1 stage")
    expect(packageJson.scripts["native:test"]).toContain("invoke-native.ps1 test")
    expect(packageJson.scripts["tauri:dev"]).toContain("invoke-native.ps1 dev")
    expect(packageJson.scripts["tauri:build"]).toContain("invoke-native.ps1 build")
    expect(invoke.indexOf("stage-webview2-loader.ps1")).toBeLessThan(invoke.indexOf("cargo test"))
    expect(invoke).toContain('@("--bundles", "msi,nsis")')
    expect(invoke).toContain('if ($Action -eq "stage") { exit 0 }')
  })

  it("stages the loader beside both release and development executables", () => {
    expect(stage).toMatch(/ValidateSet\("release", "debug"\)/)
    expect(stage).toContain('target\\$TargetProfile\\WebView2Loader.dll')
    expect(invoke).toContain('if ($Action -eq "dev") { @("release", "debug") }')
    expect(invoke).toContain("-TargetProfile $targetProfile")
  })

  it("fetches the locked Cargo graph before staging on a fresh checkout", () => {
    const fetchIndex = invoke.indexOf("cargo fetch")
    const stageIndex = invoke.indexOf("stage-webview2-loader.ps1")
    expect(fetchIndex).toBeGreaterThan(-1)
    expect(fetchIndex).toBeLessThan(stageIndex)
    expect(invoke).toMatch(/cargo fetch --manifest-path \$manifest --locked/)
    expect(invoke).toMatch(/if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/)
  })

  it("provides an installed x64 MinGW compiler and dlltool to every child process", () => {
    expect(invoke).toContain("WILLIAMOS_MINGW_BIN");
    expect(invoke).toContain('C:\\msys64\\mingw64\\bin');
    expect(invoke).toContain('C:\\mingw64\\bin');
    expect(invoke).toContain("Get-Command dlltool.exe");
    expect(invoke).toContain('Join-Path $candidate "dlltool.exe"');
    expect(invoke).toContain('Join-Path $candidate "gcc.exe"');
    expect(invoke).toMatch(/\$env:PATH\s*=\s*"\$mingwBin;/);
  });

  it("resolves windres for GNU resource compilation before invoking cargo", () => {
    expect(invoke).toContain("windres.exe");
    expect(invoke).toContain('Get-Command windres.exe');
    expect(invoke).toContain('Join-Path $candidate "windres.exe"');
    expect(invoke).toContain("requires windres.exe for resource compilation");
    expect(invoke).toContain('WILLIAMOS_WINDRES_BIN = $windresBin');
    expect(invoke).toContain('WILLIAMOS_MINGW_BIN = $mingwBin');
    const windresIndex = invoke.indexOf("windres.exe");
    const fetchIndex = invoke.indexOf("cargo fetch");
    expect(windresIndex).toBeGreaterThan(-1);
    expect(windresIndex).toBeLessThan(fetchIndex);
  });

  it("keeps the cockpit build script from destroying the inherited tool PATH", () => {
    // The build script previously REPLACED PATH with a single hardcoded MinGW directory plus
    // System32 whenever that directory existed. On GitHub's windows-2022 image the directory
    // exists without windres, so the replacement hid the resolved windres.exe and the resource
    // compiler aborted with NotAttempted("windres"). The build script must prepend resolved tool
    // directories onto the inherited PATH instead of replacing it.
    expect(buildScript).toContain('var_os("WILLIAMOS_WINDRES_BIN")');
    expect(buildScript).toContain('var_os("WILLIAMOS_MINGW_BIN")');
    expect(buildScript).toContain('split_paths');
    expect(buildScript).toContain('set_var("PATH", joined)');
    expect(buildScript).not.toContain('let paths = [');
  });

  it("takes the x64 loader only from the exact crate version pinned in Cargo.lock", () => {
    expect(cargoLock).toMatch(/name = "webview2-com-sys"\r?\nversion = "0\.38\.2"/)
    expect(stage).toContain("webview2-com-sys-0.38.2\\x64\\WebView2Loader.dll")
    expect(stage).toContain("System.Security.Cryptography.SHA256")
    expect(stage).toContain("different bytes")
  })
})
