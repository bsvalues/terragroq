// @vitest-environment jsdom

import React from "react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { UniversalIntent } from "@/components/intent/universal-intent"

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }),
  })
})

afterEach(cleanup)

describe("UniversalIntent rendered keyboard contract", () => {
  it("opens the same global composer with Ctrl+K and moves focus to its bounded intent field", async () => {
    const user = userEvent.setup()
    render(<UniversalIntent />)

    await user.keyboard("{Control>}k{/Control}")

    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Universal intent" })).toBeTruthy()
    const input = screen.getByRole("textbox", { name: "Intent" })
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute("maxlength")).toBe("2000")
  })
})
