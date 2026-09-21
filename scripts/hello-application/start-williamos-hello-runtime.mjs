#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  readDatabaseUrlFromEnv,
  resolveAuthorityRegistryUrl,
} from "../../lib/fabric/authority-registry-url.mjs"

const CANONICAL_REPOSITORY = "bsvalues/terragroq"
const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_OTP_ENABLED",
  "AUTH_EMAIL_REPLY_TO",
  "AUTH_SIGNUP_MODE",
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "RESEND_API_KEY",
  "WILLIAMOS_OWNER_EMAIL",
])

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/.test(value)) throw new Error(`HELLO_RUNTIME_${name}_INVALID`)
  return value.trim()
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function containsPath(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function explicitDirectory(value, name) {
  const supplied = required(value, name)
  if (!path.isAbsolute(supplied)) throw new Error(`HELLO_RUNTIME_${name}_INVALID`)
  if (/(^|[\\/._-])terrafusion(?:[_-]os(?:[_-][0-9.]+)?)?([\\/._-]|$)/i.test(supplied)) {
    throw new Error("HELLO_RUNTIME_TERRAFUSION_PATH_REFUSED")
  }
  const resolved = path.resolve(supplied)
  const item = fs.lstatSync(resolved, { throwIfNoEntry: false })
  if (!item?.isDirectory() || item.isSymbolicLink()) throw new Error(`HELLO_RUNTIME_${name}_INVALID`)
  const real = fs.realpathSync(resolved)
  if (!samePath(real, resolved)) throw new Error(`HELLO_RUNTIME_${name}_INVALID`)
  return real
}

export function validateApplicationTopology({
  appRoot,
  sourceRoot,
  hermesRuntimeRoot,
  applicationsRoot,
  applicationRuntimeRoot,
  applicationAssetRoot,
  applicationDeploymentRoot,
}) {
  const topology = {
    appRoot: explicitDirectory(appRoot, "APP_ROOT"),
    sourceRoot: explicitDirectory(sourceRoot, "SOURCE_ROOT"),
    hermesRuntimeRoot: explicitDirectory(hermesRuntimeRoot, "HERMES_RUNTIME_ROOT"),
    applicationsRoot: explicitDirectory(applicationsRoot, "APPLICATIONS_ROOT"),
    applicationRuntimeRoot: explicitDirectory(applicationRuntimeRoot, "APPLICATION_RUNTIME_ROOT"),
    applicationAssetRoot: explicitDirectory(applicationAssetRoot, "APPLICATION_ASSET_ROOT"),
    applicationDeploymentRoot: explicitDirectory(applicationDeploymentRoot, "APPLICATION_DEPLOYMENT_ROOT"),
  }
  if (!samePath(topology.applicationAssetRoot, topology.appRoot)) throw new Error("HELLO_RUNTIME_APPLICATION_ASSET_ROOT_INVALID")
  if (!samePath(topology.applicationRuntimeRoot, topology.hermesRuntimeRoot)) throw new Error("HELLO_RUNTIME_APPLICATION_RUNTIME_ROOT_INVALID")
  if (path.basename(topology.appRoot).toLowerCase() !== "runtime"
    || path.basename(topology.sourceRoot).toLowerCase() !== "source"
    || !samePath(path.dirname(topology.appRoot), topology.applicationDeploymentRoot)
    || !samePath(path.dirname(topology.sourceRoot), topology.applicationDeploymentRoot)) {
    throw new Error("HELLO_RUNTIME_APPLICATION_DEPLOYMENT_ROOT_INVALID")
  }
  const excluded = [topology.sourceRoot, topology.applicationDeploymentRoot, topology.applicationAssetRoot, topology.applicationRuntimeRoot]
  if (excluded.some((entry) => containsPath(entry, topology.applicationsRoot) || containsPath(topology.applicationsRoot, entry))) {
    throw new Error("HELLO_RUNTIME_APPLICATIONS_ROOT_INVALID")
  }
  return topology
}

function normalizeRepositoryIdentity(value) {
  const raw = String(value ?? "").trim().replace(/\.git$/i, "")
  const ssh = raw.match(/^git@github\.com:(.+)$/i)
  if (ssh) return ssh[1].replace(/^\/+|\/+$/g, "").toLowerCase()
  try {
    const url = new URL(raw)
    if (url.hostname.toLowerCase() !== "github.com") return null
    return url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase()
  } catch {
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? raw.toLowerCase() : null
  }
}

export function validateHelloSourceIdentity(remote) {
  return normalizeRepositoryIdentity(remote) === CANONICAL_REPOSITORY
}

export function parseHelloRuntimeEnvironment(text, {
  sourceRoot,
  canonicalOrigin,
  hermesRuntimeRoot,
  applicationsRoot,
  applicationRuntimeRoot,
  applicationAssetRoot,
  applicationDeploymentRoot,
}) {
  if (typeof text !== "string" || text.includes("\0") || text.includes("\r")) throw new Error("HELLO_RUNTIME_ENV_INVALID")
  const values = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) throw new Error("HELLO_RUNTIME_ENV_INVALID")
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\0\r\n]/.test(value)) throw new Error("HELLO_RUNTIME_ENV_INVALID")
    if (key.includes("TERRAFUSION")) throw new Error("HELLO_RUNTIME_TERRAFUSION_ENV_REFUSED")
    if (!ALLOWED_ENVIRONMENT_KEYS.has(key)) throw new Error(`HELLO_RUNTIME_ENV_KEY_REFUSED:${key}`)
    if (Object.hasOwn(values, key)) throw new Error(`HELLO_RUNTIME_ENV_DUPLICATE:${key}`)
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    if (/[\0\r\n]/.test(value)) throw new Error("HELLO_RUNTIME_ENV_INVALID")
    values[key] = value
  }

  values.WILLIAMOS_PROJECT_ROOT = required(sourceRoot, "SOURCE_ROOT")
  values.WILLIAMOS_PROJECT_SPACE_IDENTITY = values.WILLIAMOS_PROJECT_ROOT
  values.WILLIAMOS_HELLO_ENABLED = "1"
  values.WILLIAMOS_HELLO_CEREBRAS_ROUTING_ENABLED = "1"
  values.WILLIAMOS_VISIBLE_PROJECTS = "hello-application,williamos"
  values.WILLIAMOS_DEFAULT_PROJECT = "hello-application"
  values.WILLIAMOS_HERMES_RUNTIME_ROOT = required(hermesRuntimeRoot, "HERMES_RUNTIME_ROOT")
  values.WILLIAMOS_APPLICATIONS_ROOT = required(applicationsRoot, "APPLICATIONS_ROOT")
  values.WILLIAMOS_APPLICATION_RUNTIME_ROOT = required(applicationRuntimeRoot, "APPLICATION_RUNTIME_ROOT")
  values.WILLIAMOS_APPLICATION_ASSET_ROOT = required(applicationAssetRoot, "APPLICATION_ASSET_ROOT")
  values.WILLIAMOS_APPLICATION_DEPLOYMENT_ROOT = required(applicationDeploymentRoot, "APPLICATION_DEPLOYMENT_ROOT")
  values.WILLIAMOS_APPLICATION_RECONCILE_ON_START = "1"
  values.WILLIAMOS_APPLICATION_CEREBRAS_ROUTING_ENABLED = "1"
  values.BETTER_AUTH_URL = required(canonicalOrigin, "CANONICAL_ORIGIN")
  values.BETTER_AUTH_TRUSTED_ORIGINS = values.BETTER_AUTH_URL
  values.WILLIAMOS_TRUST_LOOPBACK_HTTPS_PROXY = "1"
  values.LOCAL_SETUP_ENABLED = "false"
  return values
}

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
  return value ? path.resolve(value) : null
}

export function childBaseEnvironment(source = process.env) {
  const allowed = [
    "APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT",
    "PROCESSOR_ARCHITECTURE", "ProgramData", "ProgramFiles", "ProgramW6432", "SystemDrive", "SystemRoot",
    "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "windir",
  ]
  return Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]))
}

export async function startHelloWilliamOsRuntime({
  appRoot,
  sourceRoot,
  envFile,
  logRoot,
  hermesRuntimeRoot,
  applicationsRoot,
  applicationRuntimeRoot,
  applicationAssetRoot,
  applicationDeploymentRoot,
  canonicalOrigin = "https://williamos.lan:3543",
  host = "127.0.0.1",
  port = 3201,
}) {
  const topology = validateApplicationTopology({
    appRoot,
    sourceRoot,
    hermesRuntimeRoot,
    applicationsRoot,
    applicationRuntimeRoot,
    applicationAssetRoot,
    applicationDeploymentRoot,
  })
  const app = topology.appRoot
  const source = topology.sourceRoot
  const server = path.join(app, "server.js")
  if (!fs.statSync(server, { throwIfNoEntry: false })?.isFile()) throw new Error("HELLO_RUNTIME_SERVER_MISSING")
  const top = execFileSync("git", ["-C", source, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true }).trim()
  if (fs.realpathSync(path.resolve(top)).toLowerCase() !== source.toLowerCase()) throw new Error("HELLO_RUNTIME_SOURCE_NOT_REPOSITORY_ROOT")
  const remote = execFileSync("git", ["-C", source, "config", "--get", "remote.origin.url"], { encoding: "utf8", windowsHide: true }).trim()
  if (!validateHelloSourceIdentity(remote)) throw new Error("HELLO_RUNTIME_SOURCE_IDENTITY_MISMATCH")
  const helloSource = path.join(source, "examples", "hello-application", "server.mjs")
  if (!fs.statSync(helloSource, { throwIfNoEntry: false })?.isFile()) throw new Error("HELLO_RUNTIME_APPLICATION_SOURCE_MISSING")

  const environmentText = fs.readFileSync(required(envFile, "ENV_FILE"), "utf8")
  const configured = parseHelloRuntimeEnvironment(environmentText, { sourceRoot: source, canonicalOrigin, ...topology })
  for (const requiredKey of ["DATABASE_URL", "BETTER_AUTH_SECRET", "WILLIAMOS_OWNER_EMAIL"]) {
    if (!configured[requiredKey]?.trim()) throw new Error(`HELLO_RUNTIME_${requiredKey}_REQUIRED`)
  }
  const resolvedDatabase = await resolveAuthorityRegistryUrl(readDatabaseUrlFromEnv(environmentText, envFile))
  configured.DATABASE_URL = resolvedDatabase.url

  fs.mkdirSync(logRoot, { recursive: true })
  const stdout = fs.openSync(path.join(logRoot, "hello-williamos.stdout.log"), "a")
  const stderr = fs.openSync(path.join(logRoot, "hello-williamos.stderr.log"), "a")
  const environment = {
    ...childBaseEnvironment(),
    ...configured,
    NODE_ENV: "production",
    HOSTNAME: host,
    PORT: String(port),
  }
  if (Object.keys(environment).some((key) => key.includes("TERRAFUSION"))) throw new Error("HELLO_RUNTIME_TERRAFUSION_ENV_REFUSED")
  const child = spawn(process.execPath, [server], {
    cwd: app,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  })
  const forward = (signal) => { if (child.exitCode === null) child.kill(signal) }
  process.once("SIGINT", forward)
  process.once("SIGTERM", forward)
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      fs.closeSync(stdout)
      fs.closeSync(stderr)
      if (code === 0) resolve(0)
      else reject(new Error(`HELLO_RUNTIME_SERVER_EXITED:${code ?? signal ?? "unknown"}`))
    })
  })
}

async function main() {
  const appRoot = argument("app-root")
  const sourceRoot = argument("source-root")
  const envFile = argument("env-file")
  const logRoot = argument("log-root")
  const hermesRuntimeRoot = argument("hermes-runtime-root")
  const applicationsRoot = argument("applications-root")
  const applicationRuntimeRoot = argument("application-runtime-root")
  const applicationAssetRoot = argument("application-asset-root")
  const applicationDeploymentRoot = argument("application-deployment-root")
  if (!appRoot || !sourceRoot || !envFile || !logRoot || !hermesRuntimeRoot || !applicationsRoot
    || !applicationRuntimeRoot || !applicationAssetRoot || !applicationDeploymentRoot) {
    throw new Error("usage: --app-root= --source-root= --env-file= --log-root= --hermes-runtime-root= --applications-root= --application-runtime-root= --application-asset-root= --application-deployment-root=")
  }
  await startHelloWilliamOsRuntime({
    appRoot,
    sourceRoot,
    envFile,
    logRoot,
    hermesRuntimeRoot,
    applicationsRoot,
    applicationRuntimeRoot,
    applicationAssetRoot,
    applicationDeploymentRoot,
  })
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`HELLO_WILLIAMOS_RUNTIME_FAILED|${String(error?.message ?? error).split("\n")[0]}\n`)
    process.exitCode = 1
  })
}
