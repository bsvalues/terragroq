export const WORKROOM_ALLOWED_FILES = ["**/*"] as const
export const WORKROOM_FORBIDDEN_FILES = [
  "C:/ProgramData/WilliamOS/tls/", ".env*", "migrations/", ".git/", "node_modules/", ".next/",
] as const

/** Enforce the fixed workroom grant's file envelope at the byte-mutation seam. */
export function workroomFileScope(relativePath: string): Readonly<{ ok: true } | { ok: false; detail: string }> {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  const segments = normalized.split("/")
  const basename = segments.at(-1) ?? ""
  const forbidden = basename === ".env" || basename.startsWith(".env.")
    || segments.some((segment) => ["migrations", ".git", "node_modules", ".next"].includes(segment))
  return !forbidden
    ? { ok: true }
    : { ok: false, detail: `${normalized} is forbidden by the fixed workroom authority envelope` }
}
