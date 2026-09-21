import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { parseApplicationManifest, applicationManifestDigest } from "@/lib/applications/application-manifest"

export function manifest(id = "focus-board") {
  return { schemaVersion: 1, id, displayName: "Focus Board", adapter: "static-web-v1", source: {
    document: "src/index.html", styles: "src/styles.css", script: "src/app.js", test: "test/application.test.mjs",
  }, ai: { writablePaths: ["src/index.html", "src/styles.css", "src/app.js"] } }
}

describe("application manifest v1", () => {
  it("normalizes a finite manifest and hashes the canonical projection independently of key order", () => {
    const parsed = parseApplicationManifest(manifest(), "focus-board")
    expect(parsed).toEqual(manifest())
    const canonical = '{"schemaVersion":1,"id":"focus-board","displayName":"Focus Board","adapter":"static-web-v1","source":{"document":"src/index.html","styles":"src/styles.css","script":"src/app.js","test":"test/application.test.mjs"},"ai":{"writablePaths":["src/index.html","src/styles.css","src/app.js"]}}'
    expect(applicationManifestDigest(parsed)).toBe(createHash("sha256").update(canonical).digest("hex"))
    expect(applicationManifestDigest(parseApplicationManifest({ ...manifest(), ai: { writablePaths: ["src/app.js", "src/styles.css", "src/index.html"] } }, "focus-board"))).toBe(applicationManifestDigest(parsed))
  })
  it("preserves safe leading punctuation and consecutive dots in canonical source paths", () => {
    const value = manifest()
    value.source = {
      document: "src/_main.js",
      styles: "src/-theme.js",
      script: "assets/theme..css",
      test: "test/application.test.mjs",
    }
    value.ai.writablePaths = [value.source.document, value.source.styles, value.source.script]
    expect(parseApplicationManifest(value, "focus-board")).toEqual(value)
  })
  it.each([
    { ...manifest(), schemaVersion: 2 }, { ...manifest(), adapter: "shell" },
    { ...manifest(), command: "node evil.js" }, { ...manifest(), source: { ...manifest().source, extra: "x" } },
    { ...manifest(), ai: { writablePaths: ["src/app.js", "src/app.js"] } },
    { ...manifest(), ai: { writablePaths: [".git/config"] } },
    { ...manifest(), displayName: "\ud800" }, { ...manifest(), id: "other" },
  ])("refuses schema, policy, Unicode, writable set or folder mismatch: %j", (value) => {
    expect(() => parseApplicationManifest(value, "focus-board")).toThrow()
  })
  it.each(["../index.html", "/src/index.html", "src\\index.html", "src/../index.html", "src//index.html", "C:/file", "src/a\0.html", "src/a:stream", "src/CON", "src/x."])("refuses unsafe path %s", (document) => {
    expect(() => parseApplicationManifest({ ...manifest(), source: { ...manifest().source, document } }, "focus-board")).toThrow()
  })
  it.each([
    ["styles", "src/INDEX.HTML", "src/styles.css"],
    ["script", "test/APPLICATION.TEST.MJS", "src/app.js"],
  ])("refuses Windows case alias in writable %s: %s", (field, alias, original) => {
    const value = manifest()
    const aliased = { ...value, source: { ...value.source, [field]: alias },
      ai: { writablePaths: value.ai.writablePaths.map((item) => item === original ? alias : item) } }
    expect(() => parseApplicationManifest(aliased, "focus-board")).toThrow("APPLICATION_MANIFEST_INVALID")
  })
})
