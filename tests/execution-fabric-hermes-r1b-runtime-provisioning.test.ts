import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"

import { describe, expect, it } from "vitest"

const configPath = path.join(process.cwd(), "config/execution-fabric/hermes-r1b-runtime-provisioning.json")
const scriptPath = path.join(process.cwd(), "scripts/execution-fabric/provision/provision-hermes-r1b-runtime.ps1")
const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
const source = fs.readFileSync(scriptPath, "utf8")

const wheels = [
  ["onnxruntime", "1.28.0", "onnxruntime-1.28.0-cp313-cp313-win_amd64.whl", 13_755_033, "1a1a19175464665c9b8d50bc916f216cc0b569110045b7bbca8f9f290b186f58"],
  ["numpy", "2.5.2", "numpy-2.5.2-cp313-cp313-win_amd64.whl", 12_460_532, "85aaccb24182c25df891ad0ec333585967e115269d5f1b17f2c9ae005bc96657"],
  ["flatbuffers", "25.12.19", "flatbuffers-25.12.19-py2.py3-none-any.whl", 26_661, "7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4"],
  ["packaging", "26.3", "packaging-26.3-py3-none-any.whl", 129_956, "d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c"],
  ["protobuf", "7.35.1", "protobuf-7.35.1-cp310-abi3-win_amd64.whl", 439_996, "230a75ddfc2de4806e56696ce9640c1cdfdb6543b7cfce98d42a4c0a0e7bdb87"],
  ["tokenizers", "0.22.2", "tokenizers-0.22.2-cp39-abi3-win_amd64.whl", 2_747_786, "c9ea31edff2968b44a88f97d784c2f16dc0729b8b143ed004699ebca91f05c48"],
]

const granite = [
  ["onnx/model_quint8_avx2.onnx", 313_421_909, "f1fdd44e7e1ac51f12ab7957c7bd092e064d596c288513bf9d326842f669edee"],
  ["tokenizer.json", 33_384_821, "0087c868b33bad550a78a08d19798cfd7f713cde4f020803b8f51f405503e15f"],
  ["tokenizer_config.json", 1_155_500, "7947bdf0378520e69ca412b8c4dacd1cffa8aef099f851fdd5c65aa27c6b36a0"],
  ["config.json", 1_191, "e1e3fc842a8e0537e25d6e4c93879698b92ae96722e8c162bef334b57978a3b0"],
  ["special_tokens_map.json", 694, "cb9e60dcf4d8d314315cb3e761fe4c2e664fda8dbf66d7815372b2639e381182"],
  ["1_Pooling/config.json", 313, "781299da695e58439d70d491840da22ea0935d1d57d9646eb9725f1f19754e89"],
  ["modules.json", 349, "84e40c8e006c9b1d6c122e02cba9b02458120b5fb0c87b746c41e0207cf642cf"],
  ["config_sentence_transformers.json", 283, "f09adf93fcf868bb2fc3976a435d810b2ecdffa953d1da091d2a91168abab44b"],
  ["sentence_bert_config.json", 60, "967ef958285e4a7a37d8ff1832473d967edd913b4e48572f31c3d3ea361d5327"],
]

describe("HERMES R1B reviewed runtime provisioning package", () => {
  it("pins the owner decision, fixed machine paths, and Python installer", () => {
    expect(config).toMatchObject({
      schema_version: "1.0-hermes-r1b-runtime-provisioning",
      authority: { owner_decision: 704, target_machine: "HERMES", live_application_performed: false },
      paths: {
        runtime_root: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime",
        python_root: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313",
        python_executable: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313\\python.exe",
        closure_manifest: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\runtime-closure.json",
        granite_root: "C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\models\\granite-embedding-311m-multilingual-r2",
        docker_executable: "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      },
      python: {
        version: "3.13.14",
        installer: {
          url: "https://www.python.org/ftp/python/3.13.14/python-3.13.14-amd64.exe",
          bytes: 29_225_624,
          sha256: "c54d9b9bbb8a36e6489363ddd01139707fd781d72f1f9e90c7ec65d0061368e0",
        },
        installer_policy: { all_users: true, prepend_path: false, append_path: false, install_launcher: false },
      },
    })
    expect(source).toContain("InstallAllUsers=1")
    expect(source).toContain("PrependPath=0")
    expect(source).toContain("AppendPath=0")
    expect(source).toContain("Include_launcher=0")
    expect(source).not.toMatch(/setx|\[Environment\]::SetEnvironmentVariable|CurrentUser|HKCU|HKLM/i)
  })

  it("pins the exact minimal six-wheel no-dependency closure", () => {
    expect(config.wheelhouse).toMatchObject({
      dependency_policy: "minimal-sealed-six-wheel-runtime-closure",
      install_mode: "offline-no-index-no-deps",
      tokenizers_usage: "local-native-binding-only",
      normal_dependency_resolution: false,
    })
    expect(config.wheelhouse.artifacts.map((item: any) => [item.name, item.version, item.filename, item.bytes, item.sha256])).toEqual(wheels)
    expect(config.wheelhouse.artifacts.every((item: any) => item.url.startsWith("https://files.pythonhosted.org/"))).toBe(true)
    expect(config.wheelhouse.exact_installed_distributions).toEqual([
      "flatbuffers==25.12.19", "numpy==2.5.2", "onnxruntime==1.28.0", "packaging==26.3", "protobuf==7.35.1", "tokenizers==0.22.2",
    ])
    expect(config.wheelhouse.prohibited_distributions).toEqual(expect.arrayContaining(["huggingface-hub", "requests", "httpx", "transformers", "sentence-transformers"]))
    expect(source).toContain("'--no-index', '--no-deps'")
    expect(source).toContain("installed != expected")
    expect(source).toContain("'uninstall', '--yes', 'pip'")
    expect(source).not.toMatch(/huggingface_hub|from_pretrained|pip\s+download/i)
  })

  it("pins the complete corrected Granite nine-file closure and tokenizer terms", () => {
    expect(config.granite).toMatchObject({
      repository: "ibm-granite/granite-embedding-311m-multilingual-r2",
      revision: "44399559930365213510b1ee2eb15ded83374f0e",
      total_bytes: 347_965_120,
      licensing: { model_license: "Apache-2.0", tokenizer_derivation: "Gemma 3", tokenizer_terms_apply: true },
    })
    expect(config.granite.files.map((item: any) => [item.path, item.bytes, item.sha256])).toEqual(granite)
    expect(config.granite.files.reduce((sum: number, item: any) => sum + item.bytes, 0)).toBe(347_965_120)
    expect(config.granite.licensing.statement).toMatch(/Apache-2\.0 is not the complete licensing statement/i)
    expect(config.granite.files.every((item: any) => item.url.includes("/resolve/44399559930365213510b1ee2eb15ded83374f0e/"))).toBe(true)
    expect(JSON.stringify(config)).not.toContain("c9c6169a4105c6b68b46b3eb282cb28f6cc83142cd7fe8f92e717286334632c0")
  })

  it("performs Qwen as a separate fixed Docker acquisition and verifies its payload", () => {
    expect(config.qwen).toEqual({
      action_id: "owner-decision-704-qwen-reviewed-acquisition",
      separate_reviewed_action: true,
      model: "qwen3-embedding:4b",
      container: "ollama",
      pull_command: ["exec", "ollama", "ollama", "pull", "qwen3-embedding:4b"],
      registry_manifest: {
        filename: "qwen3-embedding-4b.registry-manifest.json",
        url: "https://registry.ollama.ai/v2/library/qwen3-embedding/manifests/4b",
        bytes: 531,
        sha256: "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907",
      },
      registry_manifest_path: "/root/.ollama/models/manifests/registry.ollama.ai/library/qwen3-embedding/4b",
      manifest_payload_sha256: "df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907",
      config: {
        digest: "sha256:2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d",
        path: "/root/.ollama/models/blobs/sha256-2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d",
        bytes: 265,
        sha256: "2ca34c70bbf2dc85cb69688daf0b423bdc361504ea29d7f5a35c19f739d8ee0d",
      },
      weights: {
        digest: "sha256:2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b",
        path: "/root/.ollama/models/blobs/sha256-2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b",
        bytes: 2_496_703_776,
        sha256: "2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b",
      },
    })
    expect(source).toContain("Invoke-Fixed $ExpectedDockerExecutable $pull 'QWEN_PULL_FAILED'")
    expect(source).toContain("Save-VerifiedArtifact $Config.registry_manifest $reviewedManifestPath")
    expect(source).toContain("'stat', '-c', '%s', $ExpectedQwenManifestPath")
    expect(source).toContain("'sha256sum', $ExpectedQwenManifestPath")
    expect(source).toContain("'stat', '-c', '%s', $ExpectedQwenConfigPath")
    expect(source).toContain("'sha256sum', $ExpectedQwenConfigPath")
    expect(source).toContain("'stat', '-c', '%s', $ExpectedQwenWeightsPath")
    expect(source).toContain("'sha256sum', $ExpectedQwenWeightsPath")
    expect(source.indexOf("Save-VerifiedArtifact $Config.registry_manifest $reviewedManifestPath")).toBeLessThan(source.indexOf("Invoke-Fixed $ExpectedDockerExecutable $pull 'QWEN_PULL_FAILED'"))
    expect(source).not.toMatch(/Program Files\\Ollama|D:\\HermesData/i)
  })

  it("writes the collector-compatible complete closure and seals exact principals", () => {
    expect(source).toContain("schema_version = '1.0-williamos-embedding-runtime-closure'")
    expect(source).toContain("root = $ExpectedRuntimeRoot")
    expect(source).toContain("entries = $entries")
    expect(source).toContain("Where-Object { -not [StringComparer]::OrdinalIgnoreCase.Equals($_.FullName, $ExpectedClosureManifest) }")
    expect(source).toContain("path = $relative; sha256 = Get-FileSha256 $_.FullName; size_bytes = [UInt64]$_.Length")
    expect(config.sealing).toEqual({
      inheritance: false,
      full_control: ["NT AUTHORITY\\SYSTEM", "NT SERVICE\\TrustedInstaller"],
      read_execute: ["BUILTIN\\Users", "BUILTIN\\Administrators"],
    })
    for (const sid of ["S-1-5-18", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464", "S-1-5-32-544", "S-1-5-32-545"]) {
      expect(source).toContain(sid)
    }
    expect(source).toContain("'/inheritance:r'")
    expect(source).toContain("'/setowner'")
  })

  it("is zero-argument, fail-closed, fixed-source, and unapplied", () => {
    expect(source).toContain("if ($args.Count -ne 0)")
    expect(source).toContain("RUNTIME_ROOT_ALREADY_EXISTS")
    expect(source).toContain("STAGING_ROOT_ALREADY_EXISTS")
    expect(source).toContain("Assert-RegularFile $Destination")
    const normalizedConfig = fs.readFileSync(configPath, "utf8").replace(/\r\n/g, "\n")
    expect(source).toContain(`$ExpectedConfigSha256 = '${crypto.createHash("sha256").update(normalizedConfig).digest("hex")}'`)
    expect(source).toContain("Get-NormalizedTextSha256 $ConfigPath")
    expect(source).toContain("CONFIG_HASH_MISMATCH")
    expect(source).toContain("exit 2")
    expect(source).not.toMatch(/param\s*\(|Read-Host|Invoke-Expression|Start-Process|cmd\.exe|powershell\.exe|pwsh\.exe/i)
    expect(config.authority.live_application_performed).toBe(false)
  })
})
