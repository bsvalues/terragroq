import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

const BOOTSTRAP_PATH = "/usr/local/libexec/williamos/aegis-standing-hash-bootstrap.mjs"
const RELEASE_MANIFEST_PATH = "/etc/williamos/fabric/trusted-main-release.json"
const RELEASES_ROOT = "/opt/williamos/releases"
const ENTRYPOINT = "scripts/execution-fabric/bounded-dispatch/run-resident-aegis-standing-hash.mjs"
const BOOTSTRAP_SOURCE = "scripts/execution-fabric/bounded-dispatch/bootstrap-aegis-standing-hash.mjs"
const REQUIRED_CLOSURE = [
  BOOTSTRAP_SOURCE,
  ENTRYPOINT,
  "scripts/execution-fabric/bounded-dispatch/aegis-standing-hash-runtime.mjs",
  "scripts/execution-fabric/bounded-dispatch/aegis-hash-core.mjs",
  "scripts/execution-fabric/admission/evaluate-aegis-standing-authority.mjs",
]
const DIGEST = /^[a-f0-9]{64}$/

const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value)
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex")
const fail = (code, detail) => {
  const error = new Error(`FABRIC_AEGIS_STANDING_BOOTSTRAP_INVALID: ${code}: ${detail}`)
  error.code = code
  throw error
}

function readRootOwnedFile(filePath, maximumBytes) {
  const lexical = path.resolve(filePath)
  let descriptor
  try {
    const before = fs.lstatSync(lexical)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== 0
      || (before.mode & 0o022) !== 0 || before.size > maximumBytes) {
      fail("ROOT_FILE_UNTRUSTED", `${filePath} is not an immutable root-owned file`)
    }
    if (fs.realpathSync(lexical) !== lexical) fail("ROOT_FILE_UNTRUSTED", `${filePath} is indirect`)
    descriptor = fs.openSync(lexical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
      fail("ROOT_FILE_UNTRUSTED", `${filePath} changed during acquisition`)
    }
    return fs.readFileSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function verifyRootOwnedDirectoryChain(directoryPath) {
  const lexical = path.resolve(directoryPath)
  const parsed = path.parse(lexical)
  let current = parsed.root
  const segments = lexical.slice(parsed.root.length).split(path.sep).filter(Boolean)
  const candidates = [current]
  for (const segment of segments) {
    current = path.join(current, segment)
    candidates.push(current)
  }
  for (const candidate of candidates) {
    const stats = fs.lstatSync(candidate)
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== 0 || (stats.mode & 0o022) !== 0
      || fs.realpathSync(candidate) !== candidate) {
      fail("RELEASE_DIRECTORY_UNTRUSTED", `${candidate} is not an immutable root-owned directory`)
    }
  }
  return lexical
}

function verifiedManifest() {
  if (fileURLToPath(import.meta.url) !== BOOTSTRAP_PATH) fail("BOOTSTRAP_PATH_MISMATCH", "bootstrap is not running from its root-owned installation path")
  verifyRootOwnedDirectoryChain(path.dirname(BOOTSTRAP_PATH))
  verifyRootOwnedDirectoryChain(path.dirname(RELEASE_MANIFEST_PATH))
  readRootOwnedFile(BOOTSTRAP_PATH, 65536)
  let manifest
  try { manifest = JSON.parse(readRootOwnedFile(RELEASE_MANIFEST_PATH, 65536).toString("utf8")) } catch { fail("RELEASE_MANIFEST_UNTRUSTED", "release manifest is not valid JSON") }
  const body = { ...manifest }
  delete body.release_manifest_sha256
  if (manifest.schema_version !== "1.0-williamos-trusted-main-release"
    || manifest.repository !== "bsvalues/terragroq" || manifest.trusted_ref !== "refs/heads/main"
    || manifest.reviewed !== true || !/^[a-f0-9]{40}$/.test(manifest.head_commit ?? "")
    || !Number.isFinite(Date.parse(manifest.deployed_at))
    || manifest.release_manifest_sha256 !== sha256(Buffer.from(canonical(body), "utf8"))) {
    fail("RELEASE_MANIFEST_UNTRUSTED", "release manifest binding is invalid")
  }
  if (!manifest.file_sha256 || JSON.stringify(Object.keys(manifest.file_sha256).sort()) !== JSON.stringify([...REQUIRED_CLOSURE].sort())) {
    fail("RELEASE_MANIFEST_UNTRUSTED", "release manifest does not name the exact executable closure")
  }
  const releaseRoot = path.resolve(RELEASES_ROOT, manifest.head_commit)
  if (manifest.release_root !== releaseRoot || path.dirname(releaseRoot) !== RELEASES_ROOT) {
    fail("RELEASE_MANIFEST_UNTRUSTED", "release root is not the content-addressed reviewed-main directory")
  }
  verifyRootOwnedDirectoryChain(releaseRoot)
  for (const relative of REQUIRED_CLOSURE) {
    const expected = manifest.file_sha256[relative]
    if (!DIGEST.test(expected ?? "")) fail("RELEASE_MANIFEST_UNTRUSTED", `${relative} digest is invalid`)
    const candidate = relative === BOOTSTRAP_SOURCE ? BOOTSTRAP_PATH : path.resolve(releaseRoot, ...relative.split("/"))
    verifyRootOwnedDirectoryChain(path.dirname(candidate))
    if ((relative !== BOOTSTRAP_SOURCE && !candidate.startsWith(`${releaseRoot}${path.sep}`))
      || sha256(readRootOwnedFile(candidate, 1024 * 1024)) !== expected) {
      fail("EXECUTABLE_CLOSURE_MISMATCH", `${relative} does not match the root-owned release manifest`)
    }
  }
  return { manifest, releaseRoot }
}

async function main() {
  const { manifest, releaseRoot } = verifiedManifest()
  const entrypoint = path.resolve(releaseRoot, ...ENTRYPOINT.split("/"))
  const runner = await import(`${pathToFileURL(entrypoint).href}?release=${manifest.head_commit}`)
  const result = await runner.runResidentAegisStandingHash(process.argv.slice(2))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    schema_version: "1.0-aegis-standing-bootstrap-error",
    status: "FAILED_CLOSED",
    code: error?.code ?? "AEGIS_STANDING_BOOTSTRAP_FAILED",
    detail: String(error?.message ?? error),
    execution_authorized: false,
    scheduler_activated: false,
    autonomous_selection: false,
  }, null, 2)}\n`)
  process.exitCode = 2
})
