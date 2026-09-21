import { createHash } from "node:crypto"

export type ApplicationManifest = Readonly<{
  schemaVersion: 1
  id: string
  displayName: string
  adapter: "static-web-v1"
  source: Readonly<{ document: string; styles: string; script: string; test: string }>
  ai: Readonly<{ writablePaths: readonly string[] }>
}>
export const MAX_APPLICATION_FILE_BYTES = 262_144
export const MAX_APPLICATION_MANIFEST_BYTES = 8_192
const reserved = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

export function isApplicationId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)
    && !reserved.test(value) && !["terrafusion", "williamos", "hello-application"].includes(value)
}

export function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && Buffer.from(value, "utf8").toString("utf8") === value
}

function sourcePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && value.split("/").length >= 2
    && value.split("/").every((part) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)
      && !part.endsWith(".") && !reserved.test(part))
    && !value.startsWith(".git/") && !value.startsWith(".williamos/")
}

export function parseApplicationManifest(value: unknown, folderId: string): ApplicationManifest {
  const fail = () => { throw new Error("APPLICATION_MANIFEST_INVALID") }
  if (!exactKeys(value, ["schemaVersion", "id", "displayName", "adapter", "source", "ai"])) return fail()
  if (value.schemaVersion !== 1 || !isApplicationId(value.id) || value.id !== folderId
    || !validDisplayName(value.displayName) || value.adapter !== "static-web-v1") return fail()
  if (!exactKeys(value.source, ["document", "styles", "script", "test"]) || !exactKeys(value.ai, ["writablePaths"])) return fail()
  const { document, styles, script, test } = value.source
  if (!sourcePath(document) || !sourcePath(styles) || !sourcePath(script) || test !== "test/application.test.mjs"
    || new Set([document, styles, script, test]).size !== 4) return fail()
  const writable = value.ai.writablePaths
  const expected = [document, styles, script]
  if (!Array.isArray(writable) || writable.length !== 3 || new Set(writable).size !== 3
    || !expected.every((item) => writable.includes(item))) return fail()
  return { schemaVersion: 1, id: value.id, displayName: value.displayName, adapter: "static-web-v1",
    source: { document, styles, script, test }, ai: { writablePaths: expected } }
}

export function applicationManifestDigest(manifest: ApplicationManifest): string {
  return createHash("sha256").update(JSON.stringify(parseApplicationManifest(manifest, manifest.id)), "utf8").digest("hex")
}
