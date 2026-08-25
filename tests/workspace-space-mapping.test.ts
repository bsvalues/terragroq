import { describe, expect, it } from "vitest"

import { defaultSpace, spaceToServer } from "@/components/workspace-shell/types"
import { validateSpaceState } from "@/lib/environment/working-world"

const geometry = (z: number) => ({ x: 100, y: 90, width: 560, height: 480, z, minimized: false })

describe("browser-to-server Space mapping", () => {
  it("persists reconstructable summoned Inspectors while transient payload surfaces cannot break core continuity", () => {
    const base = defaultSpace(1400, 900)
    const mapped = spaceToServer({
      ...base,
      inspectorWindows: {
        "inspector-project": geometry(3),
        "inspector-browser": geometry(4),
        "inspector-trace": geometry(5),
      },
      inspectorSeeds: {
        "inspector-project": { kind: "project", subject: "TerraFusion projects" },
        "inspector-browser": { kind: "browser", subject: "/sign-in" },
        "inspector-trace": { kind: "trace", subject: "auth probe" },
      },
      activeWindowId: "inspector-trace",
    })

    expect(mapped.windows.map((window) => window.id)).toEqual([
      "workspace-editor", "workspace-running-app", "inspector-project",
    ])
    // An unsupported transient Inspector never becomes an invalid active-window reference.
    expect(mapped.activeWindowId).toBeNull()
    expect(() => validateSpaceState(mapped)).not.toThrow()
    expect(validateSpaceState(mapped).windows.at(-1)).toMatchObject({
      kind: "inspector", surfaceKind: "project", surfaceSubject: "TerraFusion projects",
    })
  })
})
