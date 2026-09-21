import { createHash } from "node:crypto"
import path from "node:path"
import { parse } from "next/dist/compiled/acorn"
import { applicationManifestDigest, MAX_APPLICATION_FILE_BYTES, parseApplicationManifest, type ApplicationManifest } from "./application-manifest"
import { readApplicationFile, readApplicationRepository, type CatalogApplication } from "./application-catalog"

export const MAX_ARTIFACT_BYTES = 1_000_000
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
export type StaticWebArtifact = Readonly<{
  manifest: ApplicationManifest; manifestDigest: string; sourceHead: string; sourceDigest: string
  artifactSha256: string; html: string; files: Readonly<Record<string, string>>
}>
const fail = (): never => { throw new Error("APPLICATION_ARTIFACT_DOCUMENT_INVALID") }
const voidTags = new Set(["meta", "link", "input", "br", "hr", "img", "wbr", "col"])
const allowedTags = new Set(("html head body title meta link script main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 form label input button select option textarea ul ol li dl dt dd strong em b i u s small code pre blockquote a img br hr wbr table caption colgroup col thead tbody tfoot tr th td details summary progress meter time output fieldset legend" ).split(" "))

function inlineScript(source: string): string {
  const escaped = source.replace(/<(?=\/script|script|!--)/gi, "\\u003c")
  const syntax = (text: string) => JSON.stringify(parse(text, { ecmaVersion: "latest", sourceType: "script" }), function (key, value) {
    if (key === "start" || key === "end" || (key === "raw" && this.type === "Literal")) return undefined
    return typeof value === "bigint" ? `${value}n` : value
  })
  try { if (syntax(source) !== syntax(escaped)) throw new Error() }
  catch { throw new Error("APPLICATION_ARTIFACT_SCRIPT_INVALID") }
  return escaped
}
function inlineStyle(source: string): string {
  const decoded = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi, (_match, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : char)
  if (/@import\b|\burl\s*\(/i.test(decoded) || /\\<\/style/i.test(source)) throw new Error("APPLICATION_ARTIFACT_STYLE_INVALID")
  return source.replace(/</g, "\\3c ")
}

/** A deliberately small V1 HTML grammar. Reject ambiguous HTML instead of repairing it with
 * browser-dependent parsing. Scripts/styles are inserted only at the two exact manifest slots. */
export function inlineStaticDocument(manifest: ApplicationManifest, files: Readonly<Record<string, string>>): string {
  const document = files[manifest.source.document]
  if (!/^<!doctype html>\s*/i.test(document) || /<!--[\s\S]*|\u0000/.test(document)) fail()
  const expectedStyle = path.posix.relative(path.posix.dirname(manifest.source.document), manifest.source.styles)
  const expectedScript = path.posix.relative(path.posix.dirname(manifest.source.document), manifest.source.script)
  let cursor = document.match(/^<!doctype html>\s*/i)![0].length
  let styles = 0, scripts = 0
  const seen = new Set<string>(), stack: string[] = []
  let output = "<!doctype html>\n"
  while (cursor < document.length) {
    if (document[cursor] !== "<") {
      const end = document.indexOf("<", cursor); const text = document.slice(cursor, end === -1 ? document.length : end)
      if ((!stack.length || ["html", "head", "script"].includes(stack.at(-1)!)) && text.trim()) fail()
      output += text; cursor += text.length; continue
    }
    const match = /^<(\/)?([a-z][a-z0-9]*)([^<>]*)>/i.exec(document.slice(cursor))
    if (!match) fail()
    const [raw, closing, rawTag, attributes] = match!
    const tag = rawTag.toLowerCase()
    if (!allowedTags.has(tag)) fail()
    if (closing) {
      if (attributes.trim() || stack.pop() !== tag || voidTags.has(tag)) fail()
      if (tag !== "script") output += raw
      cursor += raw.length; continue
    }
    if (["html", "head", "body"].includes(tag)) {
      if (seen.has(tag) || (tag === "html" ? stack.length !== 0 : stack.join("/") !== "html")) fail()
      if (tag === "body" && !seen.has("head")) fail()
      seen.add(tag)
    } else if (!stack.length || stack.at(-1) === "html" || stack.includes("script")) fail()
    const attrs: Record<string, string> = {}
    let rest = attributes
    while (rest.trim()) {
      const attr = /^\s+([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'))?/i.exec(rest)
      if (!attr) fail()
      const name = attr![1].toLowerCase(), value = attr![2] ?? attr![3] ?? ""
      if (Object.hasOwn(attrs, name) || name.startsWith("on") || ["style", "srcdoc", "http-equiv", "xml", "xmlns", "is", "formaction", "action", "ping", "srcset", "background", "data"].includes(name) || /[\u0000-\u001f\u007f]/.test(value)) fail()
      if (["src", "href"].includes(name) && !["link", "script"].includes(tag)
        && !(tag === "a" && name === "href" && /^#[A-Za-z0-9_-]*$/.test(value))) fail()
      attrs[name] = value; rest = rest.slice(attr![0].length)
    }
    if (tag === "link") {
      if (stack.at(-1) !== "head" || ++styles !== 1 || Object.keys(attrs).sort().join(",") !== "href,rel" || attrs.rel !== "stylesheet" || attrs.href !== expectedStyle) fail()
      // CSS escapes and JS Unicode escapes prevent an HTML raw-text terminator from escaping
      // its element, including script double-escape transitions involving HTML comments.
      output += `<style>${inlineStyle(files[manifest.source.styles])}</style>`
    } else if (tag === "script") {
      if (stack.at(-1) !== "body" || ++scripts !== 1 || Object.keys(attrs).join(",") !== "src" || attrs.src !== expectedScript) fail()
      output += `<script>${inlineScript(files[manifest.source.script])}</script>`
    } else output += raw
    if (!voidTags.has(tag)) stack.push(tag)
    cursor += raw.length
  }
  if (stack.length || seen.size !== 3 || styles !== 1 || scripts !== 1 || Buffer.byteLength(output) > MAX_ARTIFACT_BYTES) fail()
  return output
}

export function verifyStoredArtifact(value: StaticWebArtifact): StaticWebArtifact {
  const manifest = parseApplicationManifest(value.manifest, value.manifest.id)
  const paths = Object.values(manifest.source)
  if (Object.keys(value.files).sort().join("\0") !== [...paths].sort().join("\0")
    || paths.some((relative) => typeof value.files[relative] !== "string" || Buffer.byteLength(value.files[relative]) > MAX_APPLICATION_FILE_BYTES
      || Buffer.from(value.files[relative]).toString("utf8") !== value.files[relative])
    || !/^[a-f0-9]{40,64}$/.test(value.sourceHead) || applicationManifestDigest(manifest) !== value.manifestDigest
    || sha256(JSON.stringify(paths.map((relative) => [relative, value.files[relative]]))) !== value.sourceDigest
    || inlineStaticDocument(manifest, value.files) !== value.html || sha256(value.html) !== value.artifactSha256) throw new Error("APPLICATION_ARTIFACT_INVALID")
  return value
}

export async function createStaticWebArtifact(application: CatalogApplication, seams: { afterRead?: () => Promise<void> } = {}): Promise<StaticWebArtifact> {
  const read = async () => {
    const verified = await readApplicationRepository(application.repositoryRoot, application.manifest.id)
    if (verified.head !== application.head || verified.manifestDigest !== application.manifestDigest) throw new Error("APPLICATION_SOURCE_CHANGED")
    const files: Record<string, string> = {}
    for (const relative of Object.values(application.manifest.source)) files[relative] = await readApplicationFile(application.repositoryRoot, relative)
    return files
  }
  const files = await read()
  await seams.afterRead?.()
  if (JSON.stringify(files) !== JSON.stringify(await read())) throw new Error("APPLICATION_SOURCE_CHANGED")
  const html = inlineStaticDocument(application.manifest, files)
  return { manifest: application.manifest, manifestDigest: application.manifestDigest, sourceHead: application.head,
    sourceDigest: sha256(JSON.stringify(Object.entries(files))), artifactSha256: sha256(html), html, files }
}
