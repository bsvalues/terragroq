import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Stamp the exact source commit into the artifact, at build time (#762 deploy doctrine, 2026-08-20).
 *
 * "A deploy verification that does not prove the artifact was built from the current commit is not a
 * deploy verification." This runs in the `build` script AFTER clean-next and BEFORE `next build`, so
 * the SHA it writes is baked into the standalone bundle by value (the health route imports this JSON,
 * and Next inlines an imported module's value at build). The deploy then reads the running instance's
 * reported SHA and refuses to call the deploy verified unless it equals the commit that was built.
 *
 * Resolution order for the SHA: an explicit WILLIAMOS_BUILD_SHA (CI may set it), else `git rev-parse
 * HEAD`. If neither is available the SHA is "unknown" -- which the deploy check treats as UNPROVEN,
 * never as a pass. A "-dirty" suffix marks a build made over uncommitted changes.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "lib", "generated", "build-provenance.json")

function resolveSha() {
  const fromEnv = process.env.WILLIAMOS_BUILD_SHA?.trim()
  if (fromEnv) return fromEnv
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    let dirty = ""
    try {
      // Exclude our OWN output from the dirtiness check: this file is tracked (so the health route can
      // import it) and rewritten on every build, so a plain `git status` would always see it modified
      // and stamp "-dirty" even on a clean source tree (Codex P2). Real source changes still count.
      const status = execFileSync(
        "git",
        ["status", "--porcelain", "--", ".", ":(exclude)lib/generated/build-provenance.json"],
        { cwd: root, encoding: "utf8" },
      ).trim()
      if (status) dirty = "-dirty"
    } catch {
      // status is best-effort; absence of it does not invalidate the HEAD SHA.
    }
    return head ? `${head}${dirty}` : "unknown"
  } catch {
    return "unknown"
  }
}

// A fixed timestamp source: builds are reproducible-ish and this file must not churn on no-op
// rebuilds of the same commit beyond its own timestamp. SOURCE_DATE_EPOCH (seconds) is honored when
// set, else wall clock.
function resolveBuiltAt() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH)
  const ms = Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()
  return new Date(ms).toISOString()
}

const provenance = { sha: resolveSha(), builtAt: resolveBuiltAt() }
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.writeFileSync(target, `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
process.stdout.write(`build provenance: ${provenance.sha} @ ${provenance.builtAt}\n`)
