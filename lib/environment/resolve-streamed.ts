/**
 * Completes React streaming-SSR suspense boundaries in static HTML.
 *
 * The environment's cookieless proxy strips scripts before framing a page (an opaque-origin sandbox
 * makes the page's own boot code throw and tear down the markup). But Next streams suspended
 * content: the visible document holds the Suspense FALLBACK, and the real content arrives later in
 * `<div hidden id="S:n">` segments that inline `$RS`/`$RC` scripts swap into place. Strip the
 * scripts and the page shows its loading fallback forever.
 *
 * This transform performs those swaps server-side, in document order, exactly twice over:
 *   $RS("S:n", "P:n") — a segment lands at its outlet: `<template id="P:n">` is replaced by the
 *     hidden div's children.
 *   $RC("B:n", "S:n") — a boundary completes: from `<!--$?--><template id="B:n"></template>` up to
 *     the boundary's balanced `<!--/$-->`, the fallback is replaced by the hidden div's children.
 * Hidden segments are consumed as they are applied; a segment with no matching outlet or boundary is
 * left alone (better an honest fallback than eaten markup).
 */

const OPEN_MARKERS = ["<!--$-->", "<!--$?-->", "<!--$!-->"]
const CLOSE_MARKER = "<!--/$-->"

/** Finds the balanced close marker for a boundary whose open marker starts at `from`. */
function findBoundaryClose(html: string, from: number): number {
  let depth = 0
  let i = from
  while (i < html.length) {
    const nextOpen = OPEN_MARKERS.map((m) => html.indexOf(m, i)).filter((n) => n !== -1).sort((a, b) => a - b)[0] ?? -1
    const nextClose = html.indexOf(CLOSE_MARKER, i)
    if (nextClose === -1) return -1
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + 1
    } else {
      depth -= 1
      if (depth === 0) return nextClose
      i = nextClose + 1
    }
  }
  return -1
}

/** Extracts a balanced `<div hidden id="...">…</div>` starting at `start`; returns [inner, end]. */
function extractHiddenDiv(html: string, start: number): [string, number] | null {
  const openEnd = html.indexOf(">", start)
  if (openEnd === -1) return null
  let depth = 1
  let i = openEnd + 1
  while (i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + 4
    } else {
      depth -= 1
      if (depth === 0) return [html.slice(openEnd + 1, nextClose), nextClose + "</div>".length]
      i = nextClose + 6
    }
  }
  return null
}

export function resolveStreamedSuspense(html: string): string {
  // Segments can nest (a boundary's content may itself contain outlets), so keep passing until a
  // pass applies nothing. Bounded: every application consumes one hidden segment.
  for (let pass = 0; pass < 32; pass += 1) {
    const match = /<div hidden id="(S:\d+)"/.exec(html)
    if (!match) return html
    const segmentId = match[1]
    const extracted = extractHiddenDiv(html, match.index)
    if (!extracted) return html
    const [content, segmentEnd] = extracted
    const withoutSegment = html.slice(0, match.index) + html.slice(segmentEnd)

    const n = segmentId.slice(2)
    const outletTag = `<template id="P:${n}"></template>`
    const boundaryTag = `<template id="B:${n}"></template>`

    if (withoutSegment.includes(outletTag)) {
      html = withoutSegment.replace(outletTag, content)
      continue
    }

    const boundaryAt = withoutSegment.indexOf(boundaryTag)
    if (boundaryAt !== -1) {
      const openAt = withoutSegment.lastIndexOf("<!--$?-->", boundaryAt)
      const closeAt = openAt === -1 ? -1 : findBoundaryClose(withoutSegment, openAt)
      if (openAt !== -1 && closeAt !== -1) {
        html =
          withoutSegment.slice(0, openAt) +
          "<!--$-->" +
          content +
          CLOSE_MARKER +
          withoutSegment.slice(closeAt + CLOSE_MARKER.length)
        continue
      }
    }

    // No home for this segment: leave the document as it arrived rather than guessing.
    return html
  }
  return html
}
