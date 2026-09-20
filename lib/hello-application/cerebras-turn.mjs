import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const MODELS = new Set(["gpt-oss-120b", "qwen-3.8-27b"])
const HELLO_PATHS = new Set([
  "examples/hello-application/src/app.js",
  "examples/hello-application/src/index.html",
  "examples/hello-application/src/styles.css",
])
const MAX_PROCESS_OUTPUT_BYTES = 512_000
const MAX_FILE_BYTES = 64_000
const SHA256 = /^sha256:[0-9a-f]{64}$/

function samePath(left, right) {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function openContainedRegularFile(root, target, code) {
  let descriptor
  try {
    const before = fs.lstatSync(target, { bigint: true })
    const resolved = fs.realpathSync(target)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || !samePath(resolved, target)
      || !resolved.startsWith(`${root}${path.sep}`)) throw new Error()
    descriptor = fs.openSync(target, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor, { bigint: true })
    const after = fs.lstatSync(target, { bigint: true })
    if (!opened.isFile() || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1n
      || opened.dev !== after.dev || opened.ino !== after.ino) throw new Error()
    return { descriptor, dev: opened.dev, ino: opened.ino }
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch { /* Preserve the boundary failure. */ }
    }
    throw new Error(code)
  }
}

function revalidateOpenFile(root, target, opened, expectedContent, code) {
  try {
    const current = fs.lstatSync(target, { bigint: true })
    const descriptor = fs.fstatSync(opened.descriptor, { bigint: true })
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n
      || current.dev !== opened.dev || current.ino !== opened.ino
      || descriptor.dev !== opened.dev || descriptor.ino !== opened.ino
      || !samePath(fs.realpathSync(target), target)
      || fs.readFileSync(target, "utf8") !== expectedContent
      || !target.startsWith(`${root}${path.sep}`)) throw new Error()
  } catch { throw new Error(code) }
}

function safeChildEnvironment(source = process.env) {
  const allowed = [
    "APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT",
    "PROCESSOR_ARCHITECTURE", "ProgramData", "ProgramFiles", "ProgramW6432", "SystemDrive", "SystemRoot",
    "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "windir",
  ]
  return Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]))
}

function invokeCredentialBridge(payload) {
  return new Promise((resolve, reject) => {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
    const wrapper = path.resolve(moduleDirectory, "..", "..", "scripts", "execution-fabric", "invoke-cerebras-hello-change.ps1")
    const windowsRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
    const executable = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const child = spawn(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper], {
      cwd: path.dirname(wrapper),
      env: safeChildEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error("HELLO_CEREBRAS_TIMEOUT")))
    }, 135_000)
    child.once("error", () => finish(() => reject(new Error("HELLO_CEREBRAS_UNAVAILABLE"))))
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill()
        finish(() => reject(new Error("HELLO_CEREBRAS_RESPONSE_INVALID")))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > 64_000) child.kill()
    })
    child.once("close", (code) => finish(() => {
      let result
      try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")) }
      catch { reject(new Error("HELLO_CEREBRAS_RESPONSE_INVALID")); return }
      if (code !== 0 || result?.status !== "SUCCEEDED") {
        const safeCode = typeof result?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(result.code)
          ? result.code : "HELLO_CEREBRAS_EXECUTION_FAILED"
        reject(new Error(safeCode))
        return
      }
      resolve(result)
    }))
    child.stdin.end(`${JSON.stringify(payload)}\n`, "utf8")
  })
}

function resultRecord(value, model, allowedPaths) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || value.status !== "SUCCEEDED"
    || value.code !== "CEREBRAS_HELLO_CHANGE_OK" || value.provider !== "cerebras"
    || value.requestedModel !== model || value.actualModel !== model || !MODELS.has(model)
    || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > allowedPaths.length
    || !value.usage || !Number.isSafeInteger(value.usage.promptTokens) || !Number.isSafeInteger(value.usage.completionTokens)
    || value.usage.totalTokens !== value.usage.promptTokens + value.usage.completionTokens
    || typeof value.calculatedCostUsd !== "number" || !Number.isFinite(value.calculatedCostUsd) || value.calculatedCostUsd < 0
    || value.requestedMaxCostUsd !== 0.03 || value.calculatedCostUsd > value.requestedMaxCostUsd
    || !SHA256.test(value.contextDigest) || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) {
    throw new Error("HELLO_CEREBRAS_RESPONSE_INVALID")
  }
  const changed = new Set()
  for (const change of value.changes) {
    if (!change || typeof change !== "object" || Object.keys(change).sort().join(",") !== "content,path"
      || typeof change.path !== "string" || !allowedPaths.includes(change.path) || changed.has(change.path)
      || typeof change.content !== "string" || change.content.length < 1 || change.content.includes("\0")
      || Buffer.byteLength(change.content, "utf8") > MAX_FILE_BYTES) {
      throw new Error("HELLO_CEREBRAS_RESPONSE_INVALID")
    }
    changed.add(change.path)
  }
  return value
}

export async function runCerebrasHelloTurn({
  workspacePath,
  requestText,
  model,
  allowedPaths,
  invoke = invokeCredentialBridge,
}) {
  if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)
    || typeof requestText !== "string" || requestText.trim() !== requestText || !requestText
    || !MODELS.has(model) || !Array.isArray(allowedPaths) || allowedPaths.length !== HELLO_PATHS.size
    || new Set(allowedPaths).size !== HELLO_PATHS.size || allowedPaths.some((item) => !HELLO_PATHS.has(item))) {
    throw new Error("HELLO_CEREBRAS_REQUEST_INVALID")
  }
  const root = fs.realpathSync(workspacePath)
  const openedFiles = new Map()
  try {
    const sourceFiles = allowedPaths.map((relative) => {
      if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("\\") || relative.split("/").includes("..")) {
        throw new Error("HELLO_CEREBRAS_REQUEST_INVALID")
      }
      const target = path.resolve(root, relative)
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error("HELLO_CEREBRAS_REQUEST_INVALID")
      const opened = openContainedRegularFile(root, target, "HELLO_CEREBRAS_REQUEST_INVALID")
      let content
      try { content = fs.readFileSync(opened.descriptor, "utf8") }
      catch {
        fs.closeSync(opened.descriptor)
        throw new Error("HELLO_CEREBRAS_REQUEST_INVALID")
      }
      if (content.includes("\0") || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
        fs.closeSync(opened.descriptor)
        throw new Error("HELLO_CEREBRAS_REQUEST_INVALID")
      }
      openedFiles.set(relative, { ...opened, target, content })
      return { path: relative, content }
    })
    const value = resultRecord(await invoke({
      schemaVersion: 1,
      model,
      requestText,
      files: sourceFiles,
    }), model, allowedPaths)
    const replacements = value.changes.map((change) => ({ ...change, opened: openedFiles.get(change.path) }))
    for (const replacement of replacements) {
      if (!replacement.opened) throw new Error("HELLO_CEREBRAS_RESPONSE_INVALID")
      revalidateOpenFile(root, replacement.opened.target, replacement.opened, replacement.opened.content,
        "HELLO_CEREBRAS_RESPONSE_INVALID")
    }
    for (const replacement of replacements) {
      fs.ftruncateSync(replacement.opened.descriptor, 0)
      const bytes = Buffer.from(replacement.content, "utf8")
      let offset = 0
      while (offset < bytes.length) {
        const written = fs.writeSync(replacement.opened.descriptor, bytes, offset, bytes.length - offset, offset)
        if (!Number.isSafeInteger(written) || written < 1) throw new Error("HELLO_CEREBRAS_RESPONSE_INVALID")
        offset += written
      }
      fs.fsyncSync(replacement.opened.descriptor)
    }
    return {
      threadId: `cerebras-${crypto.randomUUID()}`,
      turnId: `turn-${crypto.randomUUID()}`,
      model,
      executionNode: "cerebras-api",
      ignoredPathsCreated: [],
      providerExecution: {
        route: "external",
        provider: "cerebras",
        bridgeNode: "hermes-node",
        inferenceNode: "cerebras-api",
        mode: "credential-bridge-one-shot",
        requestedModel: model,
        actualModel: model,
        externalEgress: true,
        ...value.usage,
        calculatedCostUsd: value.calculatedCostUsd,
        maxCostUsd: value.requestedMaxCostUsd,
        contextDigest: value.contextDigest,
        durationMs: value.durationMs,
      },
    }
  } finally {
    for (const opened of openedFiles.values()) {
      try { fs.closeSync(opened.descriptor) } catch { /* The proposal service owns worktree cleanup. */ }
    }
  }
}
