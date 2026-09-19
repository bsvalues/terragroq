// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProjectSwitcher } from "@/components/workspace-shell/project-switcher"

describe("ProjectSwitcher", () => {
  it("makes the active Hello Application and the other visible projects explicit", () => {
    render(<ProjectSwitcher
      activeProjectKey="hello-application"
      projects={[
        { key: "hello-application", name: "Hello Application" },
        { key: "williamos", name: "WilliamOS" },
      ]}
    />)

    expect(screen.getByRole("navigation", { name: "Project switcher" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Hello Application" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: "Hello Application" }).getAttribute("href")).toBe("/?project=hello-application")
    expect(screen.getByRole("link", { name: "WilliamOS" }).getAttribute("href")).toBe("/?project=williamos")
  })
})
