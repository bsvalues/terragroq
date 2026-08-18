import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Remove .next before a build, without deleting through symlinks.
 *
 * This exists because of a genuinely destructive interaction on Windows + pnpm. With
 * `output: "standalone"`, the first build writes `.next/standalone/node_modules/next` as a SYMLINK
 * pointing back at the real package inside pnpm's content-addressed store. The next build cleans
 * `.next` by recursing THROUGH that link, so it deletes the 7000-odd files of the `next` package
 * out of the store itself. The build then fails with a missing-module error that looks like store
 * corruption -- and every build after it fails the same way until node_modules is reinstalled.
 *
 * It cost roughly fifteen failed builds in one day before anyone measured it rather than guessing at
 * antivirus. The fix is small: Node's own fs.rm unlinks symlinks instead of following them, so
 * clearing the directory here, first, means the build never gets the chance.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// argv[2] lets the regression test point this at a fixture instead of the real build directory.
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, ".next")

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true })
}
