import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import { createStaticWebArtifact } from "@/lib/applications/static-web-artifact"
import { fixture } from "./application-runtime-fixture"
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })
async function setup() { const f = await fixture(); roots.push(f.root); return { ...f, application: await f.app() } }
describe("static artifact boundary", () => {
  it("reads only manifest sources, never evaluates code, and produces deterministic self contained HTML with digests", async () => {
    const { application } = await setup()
    await fs.writeFile(path.join(application.repositoryRoot, "src/app.js"), 'throw new Error("HOST_EXECUTED"); const text = "</script><script>evil()</script><!--<script>";')
    await fs.writeFile(path.join(application.repositoryRoot, "src/styles.css"), 'body::after { content: "</style><script>evil()</script>"; }')
    await fs.writeFile(path.join(application.repositoryRoot, "server.mjs"), 'throw new Error("SERVER_EXECUTED")')
    const artifact = await createStaticWebArtifact(application)
    expect(await createStaticWebArtifact(application)).toEqual(artifact)
    expect(Object.keys(artifact.files).sort()).toEqual(["src/app.js", "src/index.html", "src/styles.css", "test/application.test.mjs"])
    expect(artifact).toMatchObject({ sourceHead: application.head, manifestDigest: application.manifestDigest })
    expect(artifact.artifactSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(artifact.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    const dom = new JSDOM(artifact.html)
    expect(dom.window.document.querySelectorAll("script")).toHaveLength(1)
    expect(dom.window.document.querySelectorAll("style")).toHaveLength(1)
    dom.window.close()
    expect(artifact.html).not.toMatch(/src="app.js"|href="styles.css"/)
  })
  it.each([
    '<base href="https://evil.test">', '<script src="https://evil.test/a.js"></script>', '<style>body{}</style>',
    '<script>evil()</script>', '<link rel="stylesheet" href="extra.css">', '<iframe srcdoc="x"></iframe>',
    '<meta http-equiv="refresh" content="0;url=https://evil.test">', '<!--<script src="app.js"></script>-->',
    '<svg><script>evil()</script></svg>', '<html><head></head><body></body></html>', '<img src="https://evil.test/x">',
  ])("rejects ambiguous or external document shapes: %s", async (unsafe) => {
    const { application } = await setup(); const file = path.join(application.repositoryRoot, "src/index.html")
    const source = await fs.readFile(file, "utf8"); await fs.writeFile(file, source.replace("</head>", `${unsafe}</head>`))
    await expect(createStaticWebArtifact(application)).rejects.toThrow("APPLICATION_ARTIFACT_DOCUMENT_INVALID")
  })
  it("refuses source identity changes during packing", async () => {
    const { application } = await setup()
    await expect(createStaticWebArtifact(application, { afterRead: async () => { await fs.appendFile(path.join(application.repositoryRoot, "src/app.js"), "\n// racing edit") } })).rejects.toThrow("APPLICATION_SOURCE_CHANGED")
  })
  it("refuses oversized and invalid UTF-8 source", async () => {
    const { application } = await setup(); const file = path.join(application.repositoryRoot, "src/app.js")
    await fs.writeFile(file, Buffer.from([0xc3, 0x28])); await expect(createStaticWebArtifact(application)).rejects.toThrow()
    await fs.writeFile(file, "x".repeat(262145)); await expect(createStaticWebArtifact(application)).rejects.toThrow()
  })
  it("rejects script escapes that would change JavaScript syntax or tagged-template raw semantics", async () => {
    const { application } = await setup(); const file = path.join(application.repositoryRoot, "src/app.js")
    for (const source of ["let script = 1; const compare = 0<script;", "const value = String.raw`</script>`;"]) {
      await fs.writeFile(file, source)
      await expect(createStaticWebArtifact(application)).rejects.toThrow("APPLICATION_ARTIFACT_SCRIPT_INVALID")
    }
  })
  it("rejects stylesheet external dependencies instead of emitting a partial artifact", async () => {
    const { application } = await setup(); const file = path.join(application.repositoryRoot, "src/styles.css")
    await fs.writeFile(file, '@import "https://evil.test/styles.css";')
    await expect(createStaticWebArtifact(application)).rejects.toThrow("APPLICATION_ARTIFACT_STYLE_INVALID")
  })
  it("preserves CSS range operators and already escaped less-than strings byte for byte", async () => {
    const { application } = await setup()
    const css = String.raw`@media (width < 600px) { .board { color: red; } } .label::after { content: "\< already escaped"; }`
    await fs.writeFile(path.join(application.repositoryRoot, "src/styles.css"), css)
    const artifact = await createStaticWebArtifact(application)
    expect(artifact.html).toContain(`<style>${css}</style>`)
  })
  it.each(["style", "StYlE", "STYLE"])("neutralizes only raw-text closing sequences, preserving CSS string meaning for %s", async (tag) => {
    const { application } = await setup()
    const css = `.label::after { content: "</${tag}>"; } .escaped::after { content: "\\</${tag}>"; } /* </${tag} > */`
    await fs.writeFile(path.join(application.repositoryRoot, "src/styles.css"), css)
    const artifact = await createStaticWebArtifact(application)
    const expected = `.label::after { content: "<\\/${tag}>"; } .escaped::after { content: "\\<\\/${tag}>"; } /* <\\/${tag} > */`
    expect(artifact.html).toContain(`<style>${expected}</style>`)
    // CSS simple escapes represent their escaped character. Both original authored string
    // values and the emitted string values must resolve to the same literal closing tag.
    for (const literal of [expected.match(/content: "([^"]+)"/)![1], expected.match(/\.escaped::after \{ content: "([^"]+)"/)![1]]) expect(literal.replace(/\\(.)/g, "$1")).toBe(`</${tag}>`)
    const dom = new JSDOM(artifact.html)
    expect(dom.window.document.querySelectorAll("style")).toHaveLength(1)
    expect(dom.window.document.querySelectorAll("script")).toHaveLength(1)
    expect(dom.window.document.getElementById("task-form")).not.toBeNull()
    dom.window.close()
  })
})
