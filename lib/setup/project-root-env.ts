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
  if (/[\u0000-\u001f\u007f']/u.test(projectRoot)) {
    throw new Error("WILLIAMOS_PROJECT_ROOT cannot contain control characters or a single quote.")
  }
  return `'${projectRoot}'`
}
