// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WindowFrame } from "@/components/workspace-shell/window-frame"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("WindowFrame resize persistence", () => {
  it("lets window controls minimize without the frame reactivating itself", () => {
    const onActivate = vi.fn()
    const onMinimize = vi.fn()
    const onClose = vi.fn()
    render(
      <WindowFrame
        id="editor"
        title="Source"
        geometry={{ x: 20, y: 30, width: 640, height: 480, z: 1, minimized: false }}
        active={false}
        onActivate={onActivate}
        onGeometry={() => undefined}
        onMinimize={onMinimize}
        onClose={onClose}
      >
        <button type="button">Run validation</button>
      </WindowFrame>,
    )

    const minimize = screen.getByRole("button", { name: "Minimize Source" })
    fireEvent.pointerDown(minimize, { button: 0 })
    expect(onActivate).not.toHaveBeenCalled()
    fireEvent.click(minimize)
    expect(onMinimize).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(screen.getByRole("button", { name: "Close Source" }), { button: 0 })
    expect(onActivate).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole("button", { name: "Run validation" }), { button: 0 })
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it("persists the border-box size without shrinking on content-box observations", () => {
    const onGeometry = vi.fn()
    render(
      <WindowFrame
        id="editor"
        title="Source"
        geometry={{ x: 20, y: 30, width: 640, height: 480, z: 1, minimized: false }}
        active
        onActivate={() => undefined}
        onGeometry={onGeometry}
      >
        editor
      </WindowFrame>,
    )
    const frame = screen.getByRole("region", { name: "Source window" })
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      x: 20, y: 30, top: 30, right: 660, bottom: 510, left: 20,
      width: 640, height: 480, toJSON: () => ({}),
    })

    fireEvent.pointerDown(frame, { button: 0, clientX: 659, clientY: 509 })
    vi.mocked(frame.getBoundingClientRect).mockReturnValue({
      x: 20, y: 30, top: 30, right: 720, bottom: 550, left: 20,
      width: 700, height: 520, toJSON: () => ({}),
    })
    fireEvent.pointerUp(window)
    expect(onGeometry).toHaveBeenCalledWith({ x: 20, y: 30, width: 700, height: 520, z: 1, minimized: false })
  })
})
