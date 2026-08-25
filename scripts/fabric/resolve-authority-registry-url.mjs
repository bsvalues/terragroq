#!/usr/bin/env node
/**
 * Print the authority registry's connection string with ATLAS's address resolved from the canonical
 * fabric registry rather than read out of a config file.
 *
 * The settlement driver takes a path to a dotenv file and reads `DATABASE_URL` from it. That is the
 * seam where `192.168.88.5` survived a lease change and made the lab's authority oracle unreadable,
 * so this sits in that seam: same file in, same shape out, host answered by the registry.
 *
 *   resolve-authority-registry-url.mjs <source .env> [--emit=url|env] [--out=<path>] [--fabric-root=<dir>] [--redact]
 *
 * `--emit=env` writes a complete dotenv file, so the driver's input can be generated per run and
 * nothing durable holds an address again. Every failure is a non-zero exit with a typed code and no
 * output; there is no fallback to the address in the source string.
 */
import fs from "node:fs"

import {
  AuthorityRegistryUrlError,
  readDatabaseUrlFromEnv,
  redactUrl,
  resolveAuthorityRegistryUrl,
} from "../../lib/fabric/authority-registry-url.mjs"

const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const source = argv.find((a) => !a.startsWith("--"))
const emit = flag("emit") ?? "url"
const out = flag("out")
const fabricRoot = flag("fabric-root")
const redact = argv.includes("--redact")

if (!source || !["url", "env"].includes(emit)) {
  process.stderr.write(
    "usage: resolve-authority-registry-url.mjs <source .env> [--emit=url|env] [--out=<path>] "
    + "[--fabric-root=<dir>] [--redact]\n",
  )
  process.exit(2)
}

try {
  let text
  try {
    text = fs.readFileSync(source, "utf8")
  } catch (error) {
    throw new AuthorityRegistryUrlError(
      "SOURCE_ENV_UNREADABLE",
      `${source} could not be read (${error?.code ?? error?.message})`,
    )
  }

  const resolved = await resolveAuthorityRegistryUrl(readDatabaseUrlFromEnv(text, source), {
    fabricRoot: fabricRoot ?? undefined,
  })
  const url = redact ? redactUrl(resolved.url) : resolved.url
  const body = emit === "env" ? `DATABASE_URL=${url}\n` : `${url}\n`

  if (out) {
    // 0600: this file carries the registry password. The driver reads it and it is deleted by the
    // caller; it must not be world-readable in between.
    fs.writeFileSync(out, body, { encoding: "utf8", mode: 0o600 })
  } else {
    process.stdout.write(body)
  }

  process.stderr.write(JSON.stringify({
    resolvedFrom: resolved.fabricRoot,
    nodeId: resolved.nodeId,
    registryFingerprint: resolved.fingerprint,
    previousHost: resolved.previousHost,
    host: resolved.host,
    changed: resolved.changed,
    wroteTo: out ?? null,
  }) + "\n")
} catch (error) {
  if (error instanceof AuthorityRegistryUrlError) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  throw error
}
