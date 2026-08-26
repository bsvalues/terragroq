import { describe, it, expect } from "vitest"

import { geometryChanged, readBorderBoxSize } from "@/components/workspace-shell/measure"

/**
 * The frame as it is actually styled: `box-sizing: border-box` from Tailwind preflight,
 * `border: 1px solid` and `min-width: 360px / min-height: 260px` from workspace-shell.module.css.
 * So contentRect is exactly 2px under the border box on each axis.
 */
const BORDER = 1
const MIN_WIDTH = 360
const MIN_HEIGHT = 260

function entryFor(borderBox: { width: number; height: number }) {
  return {
    borderBoxSize: [{ inlineSize: borderBox.width, blockSize: borderBox.height }],
    contentRect: {
      width: borderBox.width - BORDER * 2,
      height: borderBox.height - BORDER * 2,
    },
  }
}

function element(borderBox: { width: number; height: number }) {
  return { offsetWidth: borderBox.width, offsetHeight: borderBox.height }
}

describe("window geometry is measured as a border box", () => {
  it("reads the border box, not the content box", () => {
    // The bug in one assertion: contentRect would have said 918x698.
    expect(readBorderBoxSize(entryFor({ width: 920, height: 700 }), null)).toEqual({
      width: 920,
      height: 700,
    })
  })

  it("falls back to offsetWidth/offsetHeight, which are also border box", () => {
    expect(
      readBorderBoxSize({ contentRect: { width: 918, height: 698 } }, element({ width: 920, height: 700 })),
    ).toEqual({ width: 920, height: 700 })
  })

  it("accepts a bare borderBoxSize object from older observers", () => {
    expect(
      readBorderBoxSize({ borderBoxSize: { inlineSize: 920, blockSize: 700 } }, null),
    ).toEqual({ width: 920, height: 700 })
  })

  it("returns null rather than guessing from contentRect", () => {
    // A wrong-by-2px answer that looks plausible is worse than no answer -- it is what produced
    // the shrink. With no border-box source and no element, the observation is discarded.
    expect(readBorderBoxSize({ contentRect: { width: 918, height: 698 } }, null)).toBeNull()
  })

  it("ignores a non-finite measurement", () => {
    expect(
      readBorderBoxSize(
        { borderBoxSize: [{ inlineSize: Number.NaN, blockSize: 700 }] },
        element({ width: 920, height: 700 }),
      ),
    ).toEqual({ width: 920, height: 700 })
  })

  it("rounds subpixel layout to whole pixels", () => {
    expect(
      readBorderBoxSize({ borderBoxSize: [{ inlineSize: 919.6, blockSize: 699.4 }] }, null),
    ).toEqual({ width: 920, height: 699 })
  })
})

describe("the shrink loop does not reproduce", () => {
  it("a stable window reports no change, so nothing is persisted", () => {
    const geometry = { width: 920, height: 700 }
    const measured = readBorderBoxSize(entryFor(geometry), null)!
    expect(geometryChanged(geometry, measured)).toBe(false)
  })

  it("survives 400 observation cycles without losing a pixel", () => {
    // The regression itself. Under contentRect this shed 2px per axis per cycle and reached the
    // CSS minimum in roughly 280 frames -- visibly, which is what "gets small and moves around"
    // was. 400 cycles is comfortably past where the old code had bottomed out.
    let geometry = { width: 920, height: 700 }
    for (let i = 0; i < 400; i += 1) {
      const measured = readBorderBoxSize(entryFor(geometry), null)!
      if (geometryChanged(geometry, measured)) geometry = measured
    }
    expect(geometry).toEqual({ width: 920, height: 700 })
  })

  it("never persists a size below the CSS minimum", () => {
    // 358x258 is what the live world actually held: 2px under the 360x260 the CSS enforces, which
    // nothing measuring the same box could produce.
    let geometry = { width: MIN_WIDTH, height: MIN_HEIGHT }
    for (let i = 0; i < 50; i += 1) {
      const measured = readBorderBoxSize(entryFor(geometry), null)!
      if (geometryChanged(geometry, measured)) geometry = measured
    }
    expect(geometry.width).toBeGreaterThanOrEqual(MIN_WIDTH)
    expect(geometry.height).toBeGreaterThanOrEqual(MIN_HEIGHT)
  })

  it("demonstrates what the old measurement did", () => {
    // Kept as the regression's shape rather than prose: contentRect fed back, with the original
    // `< 2` guard, which never fires because the delta is exactly 2.
    let geometry = { width: 920, height: 700 }
    for (let i = 0; i < 400; i += 1) {
      const entry = entryFor(geometry)
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      if (Math.abs(width - geometry.width) < 2 && Math.abs(height - geometry.height) < 2) break
      geometry = {
        width: Math.max(MIN_WIDTH - 2, width),
        height: Math.max(MIN_HEIGHT - 2, height),
      }
    }
    expect(geometry).toEqual({ width: MIN_WIDTH - 2, height: MIN_HEIGHT - 2 })
  })
})

describe("real resizes still register", () => {
  it("a deliberate resize is persisted", () => {
    const measured = readBorderBoxSize(entryFor({ width: 1100, height: 800 }), null)!
    expect(geometryChanged({ width: 920, height: 700 }, measured)).toBe(true)
    expect(measured).toEqual({ width: 1100, height: 800 })
  })

  it("a single-pixel resize is not swallowed", () => {
    // The old `< 2` tolerance discarded these. Exact comparison is safe now that measurement and
    // write use the same box.
    const measured = readBorderBoxSize(entryFor({ width: 921, height: 700 }), null)!
    expect(geometryChanged({ width: 920, height: 700 }, measured)).toBe(true)
  })
})
