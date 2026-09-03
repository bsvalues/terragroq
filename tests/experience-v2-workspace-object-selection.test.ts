import { describe, expect, it } from "vitest"

import { applyRestoredWorkspaceSelection, workspaceFileDirtyKey } from "@/components/workspace-shell/workspace-shell"
import { defaultSpace } from "@/components/workspace-shell/types"

const revision = "1".repeat(40)
const osRef = {
  projectIdentity: "c:/repos/terrafusion",
  repositoryResourceKey: "os-1",
  repositoryMountKey: "terrafusion:os-1:configured",
  worktreeKey: null,
  observedRevision: revision,
  path: "README.md",
}
const atlasRef = {
  ...osRef,
  repositoryResourceKey: "atlas",
  repositoryMountKey: "terrafusion:atlas:configured",
}

describe("Experience V2 repository-qualified object selection", () => {
  it("uses distinct dirty-state keys for identical paths in different repositories", () => {
    expect(workspaceFileDirtyKey("README.md", osRef)).not.toBe(workspaceFileDirtyKey("README.md", atlasRef))
  })

  it("restores the selected file identity atomically with its path and editor", () => {
    const current = {
      ...defaultSpace(),
      selectedPath: "README.md",
      selectedFileRef: osRef,
      editor: {
        ...defaultSpace().editor,
        openFiles: ["README.md"],
        openFileRefs: [osRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: osRef, selection: null }],
      },
    }
    const restored = {
      ...current,
      revision: current.revision + 1,
      selectedFileRef: atlasRef,
      editor: {
        ...current.editor,
        openFileRefs: [atlasRef],
        panes: [{ id: "primary" as const, activePath: "README.md", activeFileRef: atlasRef, selection: null }],
      },
    }

    expect(applyRestoredWorkspaceSelection(current, restored)).toMatchObject({
      revision: restored.revision,
      selectedPath: "README.md",
      selectedFileRef: atlasRef,
      editor: restored.editor,
    })
  })
})
