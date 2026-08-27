import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

/**
 * `install-forge-manifests.sh` -- the FORGE archive's manifest install, EXECUTED rather than read.
 *
 * The line this file replaced was `sudo rm -rf $remote/models/manifests && sudo mv ...`, under a
 * header promising "nothing is ever deleted on either side by this script". Blob sync is additive,
 * so every blob the archive ever received survived while the metadata naming which blobs compose
 * which model was deleted on every run -- and the completion check verified blobs only, so the run
 * that orphaned them logged OK.
 *
 * These tests run the real installer against a real filesystem, because the defect was never
 * visible in the sentence describing it. The `SUDO=` override is the only concession: the script is
 * otherwise byte-for-byte the one `sync-models-to-forge.ps1` sends to ATLAS.
 */
const INSTALLER = path.join(process.cwd(), "scripts", "lab-control", "hermes", "install-forge-manifests.sh")

const roots: string[] = []
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-manifest-"))
  roots.push(root)
  const stage = path.join(root, "stage")
  const dest = path.join(root, "archive", "manifests")
  const hist = path.join(root, "archive", "manifests-superseded", "run-1")
  return { root, stage, dest, hist }
}
function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
/**
 * A POSIX shell. `sh` is on PATH on the CI runner and on the lab's Linux hosts; on a Windows
 * developer box it is Git's, which is the same shell the deploy path uses over ssh anyway.
 */
const SH = (() => {
  if (process.platform !== "win32") return "sh"
  for (const candidate of ["C:/Program Files/Git/usr/bin/sh.exe", "C:/Program Files (x86)/Git/usr/bin/sh.exe"]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return "sh"
})()

function run(t: ReturnType<typeof tree>) {
  // On Windows, `sh.exe` invoked directly inherits the Windows PATH and none of the POSIX
  // utilities beside it. On the CI runner and on ATLAS this branch does nothing.
  const shDir = path.dirname(SH)
  const env: NodeJS.ProcessEnv = { ...process.env, SUDO: "" }
  if (process.platform === "win32" && SH !== "sh") env.PATH = `${shDir};${process.env.PATH ?? ""}`
  return execFileSync(SH, [INSTALLER, t.stage, t.dest, t.hist], { encoding: "utf8", env })
}
function filesUnder(dir: string, prefix = ""): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...filesUnder(path.join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out.sort()
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe("install-forge-manifests.sh", () => {
  it("keeps manifests the current store no longer knows about", () => {
    // The concrete case from the archive: three container-era manifests on ATLAS whose twelve blobs
    // the additive sync keeps forever. The live D: store knows nothing about them.
    const t = tree()
    write(path.join(t.dest, "registry.ollama.ai/library/qwen2/latest"), "container-era-1")
    write(path.join(t.dest, "registry.ollama.ai/library/nomic-embed-text/latest"), "container-era-2")
    write(path.join(t.dest, "registry.ollama.ai/library/llama3/8b"), "container-era-3")
    write(path.join(t.stage, "manifests/registry.ollama.ai/library/gpt-oss/20b"), "current-1")

    run(t)

    expect(filesUnder(t.dest)).toEqual([
      "registry.ollama.ai/library/gpt-oss/20b",
      "registry.ollama.ai/library/llama3/8b",
      "registry.ollama.ai/library/nomic-embed-text/latest",
      "registry.ollama.ai/library/qwen2/latest",
    ])
    expect(fs.readFileSync(path.join(t.dest, "registry.ollama.ai/library/qwen2/latest"), "utf8")).toBe("container-era-1")
  })

  it("copies a manifest aside before superseding it, and leaves identical ones alone", () => {
    const t = tree()
    write(path.join(t.dest, "registry.ollama.ai/library/gpt-oss/20b"), "old-bytes")
    write(path.join(t.dest, "registry.ollama.ai/library/qwen3/8b"), "unchanged")
    write(path.join(t.stage, "manifests/registry.ollama.ai/library/gpt-oss/20b"), "new-bytes")
    write(path.join(t.stage, "manifests/registry.ollama.ai/library/qwen3/8b"), "unchanged")

    const out = run(t)

    expect(fs.readFileSync(path.join(t.dest, "registry.ollama.ai/library/gpt-oss/20b"), "utf8")).toBe("new-bytes")
    expect(fs.readFileSync(path.join(t.hist, "registry.ollama.ai/library/gpt-oss/20b"), "utf8")).toBe("old-bytes")
    // Only the one that actually changed is copied aside; an unchanged tag is not history.
    expect(filesUnder(t.hist)).toEqual(["registry.ollama.ai/library/gpt-oss/20b"])
    expect(out).toContain("superseded=1")
  })

  it("refuses a staging tree with an unexpected layout instead of installing it", () => {
    // `scp -r src dest` copies INTO dest when dest already exists, so a retry over a surviving
    // staging path nests one level deeper every run. That layout must never reach the archive.
    const t = tree()
    write(path.join(t.stage, "manifests/manifests/registry.ollama.ai/library/gpt-oss/20b"), "nested")
    fs.rmSync(path.join(t.stage, "manifests"), { recursive: true, force: true })
    write(path.join(t.stage, "nested-instead-of-manifests/x"), "y")

    expect(() => run(t)).toThrow(/STAGING_LAYOUT_UNEXPECTED/)
    expect(filesUnder(t.dest)).toEqual([])
  })

  it("removes its own staging tree and nothing else", () => {
    const t = tree()
    write(path.join(t.dest, "registry.ollama.ai/library/qwen2/latest"), "keep-me")
    write(path.join(t.stage, "manifests/registry.ollama.ai/library/gpt-oss/20b"), "current")

    run(t)

    expect(fs.existsSync(t.stage)).toBe(false)
    expect(fs.existsSync(path.join(t.dest, "registry.ollama.ai/library/qwen2/latest"))).toBe(true)
  })
})
