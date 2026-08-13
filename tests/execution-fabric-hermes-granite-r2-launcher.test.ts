import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const launcherPath = path.join(process.cwd(), "scripts/execution-fabric/bounded-dispatch/invoke-bounded-hermes-granite-r2.ps1")
const collectorPath = path.join(process.cwd(), "scripts/execution-fabric/bounded-dispatch/collect-resident-hermes-granite-r2-evidence.ps1")
const source = fs.readFileSync(launcherPath, "utf8")
const collector = fs.readFileSync(collectorPath, "utf8")

describe("bounded resident HERMES Granite R2 launcher", () => {
  it("uses only the fixed sealed runtime and exact Granite identity", () => {
    expect(source).toContain("$RuntimeClosureManifest = 'C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\runtime-closure.json'")
    expect(source).toContain("$PythonExecutable = 'C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313\\python.exe'")
    expect(source).toContain("$SitePackagesRoot = 'C:\\Program Files\\WilliamOS\\EmbeddingRuntime\\Python313\\Lib\\site-packages'")
    expect(source).toContain("ibm-granite/granite-embedding-311m-multilingual-r2")
    expect(source).toContain("44399559930365213510b1ee2eb15ded83374f0e")
    expect(source).toContain("local-python-onnx-cls-v1")
    expect(source).not.toMatch(/qwen|ollama|docker|11435|Invoke-RestMethod|https?:\/\//i)
  })

  it("accepts zero arguments and no caller-selected command, path, or environment", () => {
    expect(source).toContain("if ($args.Count -ne 0) { Stop-Closed 'ARGUMENTS_FORBIDDEN' }")
    expect(source).not.toMatch(/Invoke-Expression|Start-Process|cmd\.exe|powershell\.exe|pwsh\.exe|GetEnvironmentVariables|shell:\s*true/i)
    expect(source).toContain("^sealed-([a-f0-9]{64})\\.json$")
    expect(source).toContain("HERMES_GRANITE_R2_ACTIVE_PROCESS_LIMIT")
  })

  it("snapshots and locks exact reviewed source, corpus, and nine model files", () => {
    for (const token of ["fabric_measure.py", "bakeoff.py", "embed.py", "metrics.py", "granite_r2_onnx.py", "documents.jsonl", "queries.jsonl", "manifest.json", "onnx/model_quint8_avx2.onnx", "model_file_count = 9", "source_file_count = 5", "corpus_file_count = 3", "[IO.FileShare]::Read", "SNAPSHOT_FILE_SET_INVALID"]) expect(source).toContain(token)
  })

  it("runs isolated Python under a Job Object with complete ceilings", () => {
    for (const token of [" -I -S ", "site.addsitedir", "CreateProcessW", "CREATE_SUSPENDED", "AssignProcessToJobObject", "ResumeThread", "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE", "JOB_OBJECT_LIMIT_PROCESS_MEMORY", "JOB_OBJECT_LIMIT_JOB_MEMORY", "JOB_OBJECT_LIMIT_ACTIVE_PROCESS", "JOB_OBJECT_LIMIT_AFFINITY", "JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP", "TerminateJobObject", "OutputLimitExceeded", "ScratchLimitExceeded"]) expect(source).toContain(token)
    expect(source.indexOf("AssignProcessToJobObject")).toBeLessThan(source.indexOf("ResumeThread"))
  })

  it("verifies the shared exact runtime closure and ACL contract", () => {
    for (const body of [source, collector]) {
      expect(body).toContain("runtime-closure.json")
      expect(body).toContain("1.0-williamos-embedding-runtime-closure")
      expect(body).toContain("entries,root,schema_version")
      expect(body).not.toContain("machine-runtime-closure.json")
      expect(body).not.toContain("1.0-williamos-machine-runtime-closure")
    }
    expect(source).toContain("path,sha256,size_bytes")
    expect(collector).toContain("Assert-ExactKeys $entry @('path', 'sha256', $SizeKey)")
    expect(collector).toContain("'size_bytes' $ClosureManifestPath")
  })

  it("emits a bounded no-network, no-container, no-write receipt", () => {
    expect(source).toContain("schema_version = '1.0-hermes-granite-r2-job-receipt'")
    for (const token of ["network_used = $false", "container_used = $false", "external_provider_used = $false", "fallback_used = $false", "database_write_performed = $false", "vector_write_performed = $false", "scratch_cleaned = $true"]) expect(source).toContain(token)
  })

  it.runIf(process.platform === "win32")("fails closed on arguments or absent fixed environment", () => {
    const powerShell = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe"
    for (const args of [[], ["unexpected"]]) {
      let output = ""; try { output = execFileSync(powerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcherPath, ...args], { encoding: "utf8", env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows" }, stdio: ["ignore", "pipe", "ignore"] }) } catch (error: any) { output = String(error.stdout ?? "") }
      expect(JSON.parse(output.trim())).toMatchObject({ status: "FAILED_CLOSED", network_used: false, container_used: false, external_provider_used: false, fallback_used: false })
    }
  })
})
