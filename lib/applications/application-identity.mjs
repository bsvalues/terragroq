import crypto from "node:crypto"

const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i
const RESERVED_APPLICATION_IDS = new Set(["terrafusion", "williamos", "hello-application"])
const catalogApplications = new WeakMap()

/** Canonical V1 application-source grammar. The returned spelling is the
 * authored POSIX-relative path; callers use the case-folded identity to catch
 * aliases without rewriting a case-sensitive repository path. */
export function normalizeApplicationRelativePath(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 160
    || value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    throw new Error("APPLICATION_PATH_INVALID")
  }
  const segments = value.split("/")
  if (segments.length < 2 || segments.some((segment) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment)
    || segment === "." || segment === ".." || segment.endsWith(".") || RESERVED_WINDOWS_NAME.test(segment))
    || value.startsWith(".git/") || value.startsWith(".williamos/")) {
    throw new Error("APPLICATION_PATH_INVALID")
  }
  return value
}

export function applicationRelativePathIdentity(value) {
  return normalizeApplicationRelativePath(value).toLowerCase()
}

/** Plain-Node-compatible application identity policy shared by the catalog and proposal runtime. */
export function isApplicationId(value) {
  return typeof value === "string" && value.length <= 64
    && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
    && !RESERVED_WINDOWS_NAME.test(value)
    && !RESERVED_APPLICATION_IDS.has(value)
}

const exactKeys = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const displayName = (value) => typeof value === "string" && value.length > 0 && value.length <= 80
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
  && Buffer.from(value, "utf8").toString("utf8") === value
const sourcePath = (value) => {
  try { return normalizeApplicationRelativePath(value) === value }
  catch { return false }
}

/** Plain-Node canonical V1 parser shared by catalog and proposal service. */
export function parseApplicationManifestValue(value, folderId) {
  const fail = () => { throw new Error("APPLICATION_MANIFEST_INVALID") }
  if (!exactKeys(value, ["schemaVersion", "id", "displayName", "adapter", "source", "ai"])) return fail()
  if (value.schemaVersion !== 1 || !isApplicationId(value.id) || value.id !== folderId
    || !displayName(value.displayName) || value.adapter !== "static-web-v1") return fail()
  if (!exactKeys(value.source, ["document", "styles", "script", "test"])
    || !exactKeys(value.ai, ["writablePaths"])) return fail()
  const { document, styles, script, test } = value.source
  if (!sourcePath(document) || !sourcePath(styles) || !sourcePath(script) || test !== "test/application.test.mjs"
    || new Set([document, styles, script, test].map(applicationRelativePathIdentity)).size !== 4) return fail()
  const writable = value.ai.writablePaths
  const expected = [document, styles, script]
  if (!Array.isArray(writable) || writable.length !== 3 || new Set(writable).size !== 3
    || !expected.every((item) => writable.includes(item))) return fail()
  return { schemaVersion: 1, id: value.id, displayName: value.displayName, adapter: "static-web-v1",
    source: { document, styles, script, test }, ai: { writablePaths: expected } }
}

export function applicationManifestDigestValue(manifest) {
  const parsed = parseApplicationManifestValue(manifest, manifest?.id)
  return crypto.createHash("sha256").update(JSON.stringify(parsed), "utf8").digest("hex")
}

/** In-process capability: only the verified catalog reader can mint a service descriptor. */
export function bindCatalogApplication(value, binding = {}) {
  if (!value || typeof value !== "object") throw new Error("APPLICATION_INVALID")
  catalogApplications.set(value, Object.freeze({ ...binding }))
  return value
}

export function isCatalogApplication(value) {
  return !!value && typeof value === "object" && catalogApplications.has(value)
}

export function catalogApplicationBinding(value) {
  return value && typeof value === "object" ? catalogApplications.get(value) ?? null : null
}
