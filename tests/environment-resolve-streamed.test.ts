import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { resolveStreamedSuspense } from "@/lib/environment/resolve-streamed"

/**
 * The proxy strips scripts before framing a page, but React streaming SSR only moves suspended
 * content into place VIA scripts -- strip them and the frame shows the Suspense fallback forever
 * ("Loading WilliamOS..." over a document that already contains the whole form). The resolver must
 * complete the stream server-side. The primary evidence is the real captured document, not a toy.
 */
describe("resolveStreamedSuspense", () => {
  it("completes the real streamed /sign-in document: fallback gone, form in place, no hidden segments", () => {
    const streamed = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/sign-in-streamed.html"), "utf8")
    expect(streamed).toContain("Loading WilliamOS")
    expect(streamed).toMatch(/<div hidden id="S:\d+"/)

    // Mirror the route's pipeline: resolve the stream, THEN strip scripts. The fallback text also
    // sits inside the RSC flight payload, which only the strip removes.
    const resolved = resolveStreamedSuspense(streamed)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*\/>/gi, "")
    expect(resolved).not.toContain("Loading WilliamOS")
    expect(resolved).not.toMatch(/<div hidden id="S:\d+"/)
    expect(resolved).not.toMatch(/<template id="[BP]:\d+">/)
    // The form is now part of the visible document, before the closing body tag and outside any
    // hidden container.
    expect(resolved).toContain('placeholder="you@command.io"')
    expect(resolved).toContain('type="password"')
    expect(resolved.indexOf("<form")).toBeGreaterThan(-1)
  })

  it("replaces a P-outlet with its segment's children ($RS)", () => {
    const html = '<main><template id="P:1"></template></main><div hidden id="S:1"><p>arrived</p></div>'
    expect(resolveStreamedSuspense(html)).toBe("<main><p>arrived</p></main>")
  })

  it("replaces a boundary's fallback with its segment's children ($RC), balanced across nesting", () => {
    const html =
      '<body><!--$?--><template id="B:0"></template><div>fallback <!--$-->inner<!--/$--></div><!--/$--></body>' +
      '<div hidden id="S:0"><section>real</section></div>'
    expect(resolveStreamedSuspense(html)).toBe("<body><!--$--><section>real</section><!--/$--></body>")
  })

  it("handles nested divs inside the hidden segment without truncating", () => {
    const html =
      '<template id="P:2"></template><div hidden id="S:2"><div><div>deep</div></div><span>tail</span></div>'
    expect(resolveStreamedSuspense(html)).toBe("<div><div>deep</div></div><span>tail</span>")
  })

  it("leaves a document untouched when a segment has no outlet and no boundary", () => {
    const html = '<body>page</body><div hidden id="S:9"><p>orphan</p></div>'
    expect(resolveStreamedSuspense(html)).toBe(html)
  })

  it("passes non-streamed documents through unchanged", () => {
    const html = "<body><form>plain</form></body>"
    expect(resolveStreamedSuspense(html)).toBe(html)
  })
})
