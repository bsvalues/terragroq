import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

import { assertProposalSecretFree } from "./proposal-secrets.mjs"

const MODELS = new Set(["gpt-oss-120b", "qwen-3.8-27b"])
const MAX_PROCESS_OUTPUT_BYTES = 512_000
export const CEREBRAS_APPLICATION_MAX_FILE_BYTES = 64_000
export const CEREBRAS_APPLICATION_MAX_SOURCE_BYTES = 128_000
const MAX_FILE_BYTES = CEREBRAS_APPLICATION_MAX_FILE_BYTES
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/

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
    descriptor = fs.openSync(target, fs.constants.O_RDWR | (process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)))
    const opened = fs.fstatSync(descriptor, { bigint: true })
    const after = fs.lstatSync(target, { bigint: true })
    if (!opened.isFile() || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1n
      || opened.dev !== after.dev || opened.ino !== after.ino) throw new Error()
    return { descriptor, dev: opened.dev, ino: opened.ino }
  } catch {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor) } catch { /* preserve boundary failure */ } }
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
      || !samePath(fs.realpathSync(target), target) || fs.readFileSync(target, "utf8") !== expectedContent
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

export function resolveCerebrasCredentialBridge({ applicationRoot = process.env.WILLIAMOS_PROJECT_ROOT } = {}) {
  try {
    if (typeof applicationRoot !== "string" || !path.isAbsolute(applicationRoot) || applicationRoot.includes("\0")) throw new Error()
    const root = fs.realpathSync(applicationRoot)
    const wrapper = path.resolve(root, "scripts", "execution-fabric", "invoke-cerebras-hello-change.ps1")
    const wrapperInfo = fs.lstatSync(wrapper, { bigint: true })
    const resolvedWrapper = fs.realpathSync(wrapper)
    if (!wrapperInfo.isFile() || wrapperInfo.isSymbolicLink() || wrapperInfo.nlink !== 1n
      || !samePath(resolvedWrapper, wrapper) || !resolvedWrapper.startsWith(`${root}${path.sep}`)) throw new Error()
    return resolvedWrapper
  } catch { throw new Error("HELLO_CEREBRAS_BRIDGE_INVALID") }
}

function resolveCerebrasReadinessAssets({ applicationRoot = process.env.WILLIAMOS_PROJECT_ROOT } = {}) {
  const wrapper = resolveCerebrasCredentialBridge({ applicationRoot })
  const root = fs.realpathSync(applicationRoot)
  const contained = (name) => {
    const target = path.resolve(root, "scripts", "execution-fabric", name)
    const stat = fs.lstatSync(target, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !samePath(fs.realpathSync(target), target)
      || !target.startsWith(`${root}${path.sep}`)) throw new Error("HELLO_CEREBRAS_BRIDGE_INVALID")
    return target
  }
  const windowsRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
  const powershell = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  const node = "C:\\Program Files\\nodejs\\node.exe"
  for (const executable of [powershell, node]) {
    const stat = fs.lstatSync(executable, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !samePath(fs.realpathSync(executable), executable)) {
      throw new Error("HELLO_CEREBRAS_BRIDGE_INVALID")
    }
  }
  return Object.freeze({
    wrapper,
    helper: contained("cerebras-credential-manager.ps1"),
    change: contained("cerebras-hello-change.mjs"),
    probe: contained("test-cerebras-credential-ready.ps1"),
    powershell,
    node,
  })
}

/** Secret-free availability proof for route advertisement. It never converts
 * the SecureString or returns credential, path, stderr, or environment data. */
export async function cerebrasCredentialBridgeReady(options = {}, seams = {}) {
  try {
    const assets = (seams.resolveAssets ?? resolveCerebrasReadinessAssets)(options)
    return await new Promise((resolve) => {
      const child = (seams.spawn ?? spawn)(assets.powershell, [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", assets.probe,
      ], {
        cwd: path.dirname(assets.probe), env: safeChildEnvironment(), shell: false, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let stdout = Buffer.alloc(0)
      let stderrBytes = 0
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const timer = setTimeout(() => { child.kill(); finish(false) }, seams.timeoutMs ?? 5_000)
      child.once("error", () => finish(false))
      child.stdout.on("data", (chunk) => {
        stdout = Buffer.concat([stdout, Buffer.from(chunk)])
        if (stdout.length > 16) { child.kill(); finish(false) }
      })
      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length
        if (stderrBytes > 1_024) { child.kill(); finish(false) }
      })
      child.once("close", (code) => finish(code === 0 && stdout.toString("utf8") === "READY"))
    })
  } catch { return false }
}

export function invokeCredentialBridge(payload, seams = {}) {
  return new Promise((resolve, reject) => {
    const wrapper = (seams.resolveBridge ?? resolveCerebrasCredentialBridge)()
    const windowsRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
    const executable = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    const child = (seams.spawn ?? spawn)(executable, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper], {
      cwd: path.dirname(wrapper), env: safeChildEnvironment(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (callback) => { if (!settled) { settled = true; clearTimeout(timer); callback() } }
    const timer = setTimeout(() => { child.kill(); finish(() => reject(new Error("APPLICATION_CEREBRAS_TIMEOUT"))) }, seams.timeoutMs ?? 135_000)
    child.once("error", () => finish(() => reject(new Error("APPLICATION_CEREBRAS_UNAVAILABLE"))))
    child.stdin.once("error", () => {
      child.kill()
      finish(() => reject(new Error("APPLICATION_CEREBRAS_UNAVAILABLE")))
    })
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) { child.kill(); finish(() => reject(new Error("APPLICATION_CEREBRAS_RESPONSE_INVALID"))); return }
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 64_000) child.kill() })
    child.once("close", (exitCode) => finish(() => {
      let result
      try { result = JSON.parse(Buffer.concat(stdout).toString("utf8")) }
      catch { reject(new Error("APPLICATION_CEREBRAS_RESPONSE_INVALID")); return }
      if (exitCode !== 0 || result?.status !== "SUCCEEDED") {
        const safeCode = typeof result?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(result.code)
          ? result.code : "APPLICATION_CEREBRAS_EXECUTION_FAILED"
        reject(new Error(safeCode)); return
      }
      resolve(result)
    }))
    child.stdin.end(`${JSON.stringify(payload)}\n`, "utf8")
  })
}

function applicationContract(application, legacyEnvelope, allowedPaths) {
  if (legacyEnvelope) return {
    id: "hello-application", displayName: "Hello Application", manifestDigest: "0".repeat(64), writablePaths: allowedPaths,
  }
  const manifest = application?.manifest
  if (!manifest || typeof manifest.id !== "string" || typeof manifest.displayName !== "string"
    || !SHA256.test(application.manifestDigest) || !Array.isArray(manifest.ai?.writablePaths)
    || manifest.ai.writablePaths.length !== 3 || new Set(manifest.ai.writablePaths).size !== 3) {
    throw new Error("APPLICATION_CEREBRAS_REQUEST_INVALID")
  }
  return { id: manifest.id, displayName: manifest.displayName, manifestDigest: application.manifestDigest, writablePaths: [...manifest.ai.writablePaths] }
}

export function applicationCerebrasCapability(application) {
  try {
    const contract = applicationContract(application, false, application?.manifest?.ai?.writablePaths)
    const root = fs.realpathSync(application.repositoryRoot)
    let total = 0
    for (const relative of contract.writablePaths) {
      const target = path.resolve(root, relative)
      const stat = fs.lstatSync(target, { bigint: true })
      const size = Number(stat.size)
      if (!target.startsWith(`${root}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n
        || !samePath(fs.realpathSync(target), target) || !Number.isSafeInteger(size) || size < 0
        || size > CEREBRAS_APPLICATION_MAX_FILE_BYTES) return Object.freeze({ available: false })
      total += size
      if (total > CEREBRAS_APPLICATION_MAX_SOURCE_BYTES) return Object.freeze({ available: false })
    }
    return Object.freeze({ available: true })
  } catch { return Object.freeze({ available: false }) }
}

function resultRecord(value, model, contract, legacyEnvelope) {
  const code = legacyEnvelope ? "HELLO_CEREBRAS_RESPONSE_INVALID" : "APPLICATION_CEREBRAS_RESPONSE_INVALID"
  const expectedSchema = legacyEnvelope ? 1 : 2
  const expectedSuccess = legacyEnvelope ? "CEREBRAS_HELLO_CHANGE_OK" : "CEREBRAS_APPLICATION_CHANGE_OK"
  if (!value || typeof value !== "object" || value.schemaVersion !== expectedSchema || value.status !== "SUCCEEDED"
    || value.code !== expectedSuccess || value.provider !== "cerebras"
    || (!legacyEnvelope && (value.applicationId !== contract.id || value.manifestDigest !== contract.manifestDigest))
    || value.requestedModel !== model || value.actualModel !== model || !MODELS.has(model)
    || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > contract.writablePaths.length
    || !value.usage || !Number.isSafeInteger(value.usage.promptTokens) || !Number.isSafeInteger(value.usage.completionTokens)
    || value.usage.totalTokens !== value.usage.promptTokens + value.usage.completionTokens
    || typeof value.calculatedCostUsd !== "number" || !Number.isFinite(value.calculatedCostUsd) || value.calculatedCostUsd < 0
    || value.requestedMaxCostUsd !== 0.03 || value.calculatedCostUsd > value.requestedMaxCostUsd
    || !/^sha256:[0-9a-f]{64}$/.test(value.contextDigest)
    || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) throw new Error(code)
  const changed = new Set()
  for (const change of value.changes) {
    if (!change || typeof change !== "object" || Object.keys(change).sort().join(",") !== "content,path"
      || typeof change.path !== "string" || !contract.writablePaths.includes(change.path) || changed.has(change.path)
      || typeof change.content !== "string" || change.content.length < 1 || change.content.includes("\0")
      || Buffer.byteLength(change.content, "utf8") > MAX_FILE_BYTES) throw new Error(code)
    changed.add(change.path)
  }
  assertProposalSecretFree(value)
  return value
}

export async function runCerebrasApplicationTurn({
  application,
  workspacePath,
  requestText,
  model,
  allowedPaths = application?.manifest?.ai?.writablePaths,
  invoke = invokeCredentialBridge,
  legacyEnvelope = false,
}) {
  const requestCode = legacyEnvelope ? "HELLO_CEREBRAS_REQUEST_INVALID" : "APPLICATION_CEREBRAS_REQUEST_INVALID"
  const responseCode = legacyEnvelope ? "HELLO_CEREBRAS_RESPONSE_INVALID" : "APPLICATION_CEREBRAS_RESPONSE_INVALID"
  if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)
    || typeof requestText !== "string" || requestText.trim() !== requestText || !requestText
    || !MODELS.has(model) || !Array.isArray(allowedPaths) || allowedPaths.length !== 3
    || new Set(allowedPaths).size !== 3) throw new Error(requestCode)
  const contract = applicationContract(application, legacyEnvelope, allowedPaths)
  if (contract.writablePaths.some((relative) => typeof relative !== "string" || path.isAbsolute(relative)
    || relative.includes("\\") || relative.split("/").some((part) => part === ".." || part === ".")
    || relative.startsWith(".williamos/") || relative.startsWith(".git/"))) throw new Error(requestCode)
  const root = fs.realpathSync(workspacePath)
  const openedFiles = new Map()
  try {
    let sourceBytes = 0
    const sourceFiles = contract.writablePaths.map((relative) => {
      const target = path.resolve(root, relative)
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error(requestCode)
      const opened = openContainedRegularFile(root, target, requestCode)
      let content
      try { content = fs.readFileSync(opened.descriptor, "utf8") }
      catch { fs.closeSync(opened.descriptor); throw new Error(requestCode) }
      if (content.includes("\0") || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
        fs.closeSync(opened.descriptor); throw new Error(requestCode)
      }
      sourceBytes += Buffer.byteLength(content, "utf8")
      if (sourceBytes > CEREBRAS_APPLICATION_MAX_SOURCE_BYTES) {
        fs.closeSync(opened.descriptor); throw new Error(requestCode)
      }
      openedFiles.set(relative, { ...opened, target, content })
      return { path: relative, content }
    })
    const payload = legacyEnvelope
      ? { schemaVersion: 1, model, requestText, files: sourceFiles }
      : { schemaVersion: 2, application: contract, model, requestText, files: sourceFiles }
    assertProposalSecretFree(payload)
    const value = resultRecord(await invoke(payload), model, contract, legacyEnvelope)
    const replacements = value.changes.map((change) => ({ ...change, opened: openedFiles.get(change.path) }))
    for (const replacement of replacements) {
      if (!replacement.opened) throw new Error(responseCode)
      revalidateOpenFile(root, replacement.opened.target, replacement.opened, replacement.opened.content, responseCode)
    }
    for (const replacement of replacements) {
      fs.ftruncateSync(replacement.opened.descriptor, 0)
      const bytes = Buffer.from(replacement.content, "utf8")
      let offset = 0
      while (offset < bytes.length) {
        const written = fs.writeSync(replacement.opened.descriptor, bytes, offset, bytes.length - offset, offset)
        if (!Number.isSafeInteger(written) || written < 1) throw new Error(responseCode)
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
        route: "external", provider: "cerebras", bridgeNode: "hermes-node", inferenceNode: "cerebras-api",
        mode: "credential-bridge-one-shot", requestedModel: model, actualModel: model, externalEgress: true,
        ...value.usage, calculatedCostUsd: value.calculatedCostUsd, maxCostUsd: value.requestedMaxCostUsd,
        contextDigest: value.contextDigest, durationMs: value.durationMs,
      },
    }
  } finally {
    for (const opened of openedFiles.values()) { try { fs.closeSync(opened.descriptor) } catch { /* service cleans workspace */ } }
  }
}
