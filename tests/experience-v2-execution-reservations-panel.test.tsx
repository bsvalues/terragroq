// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { ExecutionReservationsPanel } from "@/components/workspace-shell/execution-reservations-panel"

afterEach(cleanup)

describe("Experience V2 execution reservation evidence", () => {
  it("shows exact contract and environment collision-control claims without granting authority", async () => {
    const user = userEvent.setup()
    render(<ExecutionReservationsPanel claims={{
      contracts: [{ contractIdentity: "atlas-feature-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
      environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "exclusive" }],
    }} />)

    const panel = screen.getByRole("group", { name: "Execution reservations" })
    expect(panel.getAttribute("open")).toBeNull()
    await user.click(within(panel).getByText("Execution reservations"))
    expect(within(panel).getByText("Recorded collision-control evidence · does not grant authority.")).toBeTruthy()
    expect(within(panel).getByText("atlas-feature-projection-v1")).toBeTruthy()
    expect(within(panel).getByText("1.0.0")).toBeTruthy()
    expect(within(panel).getByText("producer")).toBeTruthy()
    expect(within(panel).getByText("preview:terrafusion:3102")).toBeTruthy()
    expect(within(panel).getByText("exclusive")).toBeTruthy()
    expect(within(panel).queryByRole("button", { name: /grant|authorize|reserve|write/i })).toBeNull()
  })

  it("renders explicit empty claims instead of manufacturing reservations", () => {
    render(<ExecutionReservationsPanel claims={{ contracts: [], environments: [] }} initiallyOpen />)

    const panel = screen.getByRole("group", { name: "Execution reservations" })
    expect(within(panel).getByText("No contract reservations were recorded.")).toBeTruthy()
    expect(within(panel).getByText("No environment reservations were recorded.")).toBeTruthy()
  })
})
