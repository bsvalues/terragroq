/**
 * Reading a window's size back out of a ResizeObserver.
 *
 * Window geometry is a BORDER-box value: it is written to inline `width`/`height` on an element
 * that Tailwind's preflight makes `box-sizing: border-box`. `entry.contentRect` is the CONTENT box,
 * which for a frame with a 1px border is exactly 2px smaller per axis.
 *
 * Feeding contentRect back therefore wrote a value 2px under the box it had just measured, every
 * observation. Each cycle shed 2px per axis and persisted it, so a 920x700 editor walked itself
 * down to the 360x260 CSS minimum over roughly 280 frames -- visibly, which is what "gets small and
 * moves around" was. It settled at a STORED 358x258: CSS held the rendered box at the minimum while
 * contentRect stayed 2px under it, so the delta finally read as zero.
 *
 * The old guard `Math.abs(delta) < 2` looks like it should have absorbed this and did not: the
 * delta was *exactly* 2, and the comparison is strict. Widening the threshold would only have
 * hidden the drift while leaving the measurement wrong -- and would have swallowed genuine 1px
 * resizes as the price.
 *
 * So: measure the same box we write. `borderBoxSize` is the direct answer; `offsetWidth` /
 * `offsetHeight` are border-box too and cover observers that do not report it.
 */

export type MeasuredSize = Readonly<{ width: number; height: number }>

/** The element fallback, kept structural so tests need no DOM. */
export type BorderBoxFallback = Readonly<{ offsetWidth: number; offsetHeight: number }>

type SizeLike = Readonly<{ inlineSize: number; blockSize: number }>

type EntryLike = Readonly<{
  borderBoxSize?: readonly SizeLike[] | SizeLike
  contentRect?: Readonly<{ width: number; height: number }>
}>

/**
 * The border-box size of an observed frame.
 *
 * `borderBoxSize` is spec'd as a frozen array, but some older implementations handed back a bare
 * object; both are accepted rather than silently falling through to the element, because the
 * fallback forces a layout read.
 */
export function readBorderBoxSize(
  entry: EntryLike,
  element: BorderBoxFallback | null | undefined,
): MeasuredSize | null {
  const boxes = entry.borderBoxSize
  const box: SizeLike | undefined = Array.isArray(boxes)
    ? boxes[0]
    : boxes && typeof boxes === "object" && "inlineSize" in boxes
      ? (boxes as SizeLike)
      : undefined

  if (box && Number.isFinite(box.inlineSize) && Number.isFinite(box.blockSize)) {
    return { width: Math.round(box.inlineSize), height: Math.round(box.blockSize) }
  }

  if (element) {
    return { width: Math.round(element.offsetWidth), height: Math.round(element.offsetHeight) }
  }

  // Deliberately NOT falling back to contentRect. A wrong-by-2px answer that looks plausible is
  // worse than no answer: it is what produced the shrink in the first place.
  return null
}

/**
 * Whether a measurement is a real change worth persisting.
 *
 * Exact comparison, on purpose. Now that measurement and write use the same box, a stable window
 * reports a delta of zero; a tolerance would only swallow genuine single-pixel resizes and would
 * re-open the door to a slow drift going unnoticed.
 */
export function geometryChanged(current: MeasuredSize, next: MeasuredSize): boolean {
  return current.width !== next.width || current.height !== next.height
}
