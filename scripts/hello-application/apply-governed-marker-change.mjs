import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const TARGETS = Object.freeze({
  app: "examples/hello-application/src/app.js",
  html: "examples/hello-application/src/index.html",
  styles: "examples/hello-application/src/styles.css",
})

function replaceOnce(source, anchor, replacement, code) {
  const first = source.indexOf(anchor)
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(code)
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`
}

function updateFile(repositoryRoot, relativePath, transform) {
  const target = path.join(repositoryRoot, ...relativePath.split("/"))
  const before = fs.readFileSync(target, "utf8")
  const after = transform(before, before.includes("\r\n") ? "\r\n" : "\n")
  if (after === before) return false
  fs.writeFileSync(target, after, "utf8")
  return true
}

export function applyGovernedMarkerChange({ repositoryRoot = process.cwd() } = {}) {
  const root = fs.realpathSync(path.resolve(repositoryRoot))
  const changedPaths = []

  if (updateFile(root, TARGETS.html, (source, eol) => {
    const marker = '        <p id="governance-marker" class="governance-marker">Governed by HERMES · build ready</p>'
    if (source.includes(marker)) return source
    if (source.includes('id="governance-marker"')) throw new Error("HELLO_GOVERNED_CHANGE_HTML_DRIFT")
    const anchor = '        <p class="status-value" id="pulse-status" data-hermes-state="placeholder">Awaiting WilliamOS connection</p>'
    return replaceOnce(source, anchor, `${anchor}${eol}${marker}`, "HELLO_GOVERNED_CHANGE_HTML_ANCHOR")
  })) changedPaths.push(TARGETS.html)

  if (updateFile(root, TARGETS.styles, (source, eol) => {
    if (source.includes(".governance-marker {")) return source
    const anchor = ".status-board dl {"
    const rule = [
      ".governance-marker {",
      "  display: inline-flex;",
      "  margin: -1rem 0 2rem;",
      "  padding: 0.38rem 0.55rem;",
      "  border: 1px solid var(--steel);",
      "  background: var(--porcelain);",
      "  color: var(--graphite);",
      "  font-family: \"Cascadia Code\", \"SFMono-Regular\", Consolas, monospace;",
      "  font-size: 0.72rem;",
      "  font-weight: 700;",
      "  letter-spacing: 0.035em;",
      "}",
      "",
    ].join(eol)
    return replaceOnce(source, anchor, `${rule}${anchor}`, "HELLO_GOVERNED_CHANGE_STYLES_ANCHOR")
  })) changedPaths.push(TARGETS.styles)

  if (updateFile(root, TARGETS.app, (source, eol) => {
    const lookup = '  const governanceMarker = root.getElementById("governance-marker")'
    const countLine = '    const pulseNumber = String(snapshot.count).padStart(3, "0")'
    const update = "    if (governanceMarker) governanceMarker.textContent = `Governed by HERMES · pulse ${pulseNumber}`"
    const complete = source.includes(lookup) && source.includes(countLine) && source.includes(update)
    if (complete) return source
    if (source.includes("governanceMarker") || source.includes("pulseNumber")) {
      throw new Error("HELLO_GOVERNED_CHANGE_APP_DRIFT")
    }
    source = replaceOnce(
      source,
      '  const statusOutput = root.getElementById("pulse-status")',
      `  const statusOutput = root.getElementById("pulse-status")${eol}${lookup}`,
      "HELLO_GOVERNED_CHANGE_APP_LOOKUP_ANCHOR",
    )
    source = replaceOnce(
      source,
      '    countOutput.textContent = String(snapshot.count).padStart(3, "0")',
      `${countLine}${eol}    countOutput.textContent = pulseNumber`,
      "HELLO_GOVERNED_CHANGE_APP_COUNT_ANCHOR",
    )
    return replaceOnce(
      source,
      "    statusOutput.textContent = snapshot.status",
      `    statusOutput.textContent = snapshot.status${eol}${update}`,
      "HELLO_GOVERNED_CHANGE_APP_STATUS_ANCHOR",
    )
  })) changedPaths.push(TARGETS.app)

  const sorted = changedPaths.sort()
  return { changedPaths: sorted }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = applyGovernedMarkerChange()
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
