import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Resolve the project's `@/` alias for plain Node, so tooling outside Next can import the real
 * governance modules.
 *
 * The work-context gate exists to stop two sources of truth from forming, so its enforcement points
 * must not each carry their own copy of the validator. Node 22.6+ strips types on import; the only
 * thing missing is the alias tsconfig gives Next, which is what this supplies. The hook then imports
 * `lib/governance/work-context-receipt.ts` itself -- the same function the HTTP path calls -- and a
 * change to the contract cannot land on one path and miss the other.
 */

const ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()
const EXTENSIONS = ["", ".ts", ".mts", ".tsx", ".mjs", ".js"]

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context)
  const base = path.join(ROOT, specifier.slice(2))
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (extension !== "" && fs.existsSync(candidate)) return next(pathToFileURL(candidate).href, context)
    if (extension === "" && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return next(pathToFileURL(candidate).href, context)
    }
  }
  // Fall through rather than inventing a path: an unresolvable alias should fail loudly here, not
  // surface later as a mysteriously absent export.
  return next(specifier, context)
}
