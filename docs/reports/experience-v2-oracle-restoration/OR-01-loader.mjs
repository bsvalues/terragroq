/**
 * A module resolution hook that substitutes exactly two specifiers and nothing else.
 *
 * The substitution list is a whitelist, not a pattern: anything not literally `next/cache` or
 * `@/lib/session` resolves through the normal chain. A loader that matched `next/*` could silently
 * replace a module the canonical code actually depends on, and the point of this file is that the
 * canonical code runs unmodified apart from two named seams.
 */
import path from "node:path"
import { pathToFileURL } from "node:url"

const HERE = import.meta.dirname

const SUBSTITUTIONS = new Map([
  ["next/cache", path.join(HERE, "OR-01-next-cache-shim.mjs")],
  ["@/lib/session", path.join(HERE, "OR-01-session-shim.mjs")],
])

export const substituted = [...SUBSTITUTIONS.keys()]

export async function resolve(specifier, context, nextResolve) {
  const hit = SUBSTITUTIONS.get(specifier)
  if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  return nextResolve(specifier, context)
}
