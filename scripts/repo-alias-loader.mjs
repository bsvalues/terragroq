import { pathToFileURL } from "node:url"
import path from "node:path"
import fs from "node:fs"

/**
 * Resolve the repository's "@/..." specifiers for plain Node.
 *
 * Next and vitest both understand the alias; a bare `node script.mjs` does not, which is why anything
 * operational previously had to be reimplemented outside the modules it was operating on. Duplicating
 * service logic in a script is how the script and the service drift apart, and drift here would mean a
 * credential enrolled by rules the application does not actually use.
 */
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")

function firstFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = firstFile(path.join(root, specifier.slice(2)))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  // TypeScript sources import siblings without an extension; Node does not guess. Without this the
  // alias resolves and then its own relative imports fail one level down.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
    const hit = firstFile(path.resolve(parentDir, specifier))
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
