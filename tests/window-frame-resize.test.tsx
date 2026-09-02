// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WindowFrame } from "@/components/workspace-shell/window-frame"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("WindowFrame resize persistence", () => {
  it("lets window controls minimize without the frame reactivating itself", () => {
    function Harness() {
      const [geometry, setGeometry] = useState({ x: 20, y: 30, width: 640, height: 480, z: 1, minimized: false })
      return (
        <WindowFrame
          id="editor"
          title="Source"
          geometry={geometry}
          active={!geometry.minimized}
          onActivate={() => setGeometry((current) => ({ ...current, minimized: false }))}
          onGeometry={setGeometry}
          onMinimize={() => setGeometry((current) => ({ ...current, minimized: true }))}
        >
          editor
        </WindowFrame>
      )
    }

    render(<Harness />)
    const minimize = screen.getByRole("button", { name: "Minimize Source" })
    fireEvent.pointerDown(minimize, { button: 0 })
    fireEvent.click(minimize)
    expect(screen.queryByRole("region", { name: "Source window" })).toBeNull()
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
