import path from "node:path"

/**
 * Double-quoted dotenv values interpret backslash escapes. Windows accepts forward slashes in
 * absolute drive and UNC paths, so persist that equivalent form there. POSIX permits a literal
 * backslash in a filename; preserving it is required to keep the configured checkout exact.
 */
export function normalizeProjectRootForEnv(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
) {
  return platform === "win32" ? projectRoot.replace(/\\/g, "/") : projectRoot
}

export function serializeProjectRootEnvValue(projectRoot: string) {
  if (/[\u0000-\u001f\u007f'$]/u.test(projectRoot)) {
    throw new Error("WILLIAMOS_TERRAFUSION_ROOT cannot contain control characters, a single quote, or a dollar sign.")
  }
  return `'${projectRoot}'`
}

/** Normalize one server-owned path identity independently of the verifier host's OS. */
export function normalizePortableAbsolutePathIdentity(value: string) {
  if (value.length < 1 || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("WILLIAMOS_TERRAFUSION_SPACE_IDENTITY is invalid.")
  }
  const windowsAbsolute = path.win32.isAbsolute(value)
  const posixAbsolute = path.posix.isAbsolute(value)
  if (!windowsAbsolute && !posixAbsolute) {
    throw new Error("WILLIAMOS_TERRAFUSION_SPACE_IDENTITY must be an absolute path.")
  }
  const pathFlavor = windowsAbsolute ? path.win32 : path.posix
  const normalized = normalizeProjectRootForEnv(pathFlavor.resolve(value), windowsAbsolute ? "win32" : "linux")
  serializeProjectRootEnvValue(normalized)
  return normalized
}
