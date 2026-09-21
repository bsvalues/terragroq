import {
  applicationManifestDigestValue,
  isApplicationId as isSharedApplicationId,
  parseApplicationManifestValue,
} from "./application-identity.mjs"

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
  return isSharedApplicationId(value)
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
  return parseApplicationManifestValue(value, folderId) as ApplicationManifest
}

export function applicationManifestDigest(manifest: ApplicationManifest): string {
  return applicationManifestDigestValue(manifest)
}
