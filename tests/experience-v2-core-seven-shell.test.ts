import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const shell = () => fs.readFileSync(path.join(process.cwd(), "components/workspace-shell/workspace-shell.tsx"), "utf8")

describe("Experience V2 Core Seven shell integration", () => {
  it("keeps the Repository Map, Change Set, and Preview composition summonable inside the Space", () => {
    const source = shell()
    expect(source).toContain("RepositoryMapSurface")
    expect(source).toContain("ChangeSetSurface")
    expect(source).toContain("PreviewComposition")
    expect(source).toContain("/api/environment/change-set")
    expect(source).toContain('aria-label="Open Change Set"')
    expect(source).toContain('aria-label="Inspect Preview composition"')
  })

  it("does not claim running composition from an attached URL alone", () => {
    const source = shell()
    expect(source).toContain('previewRuntime ? "running" : space.runningAppUrl ? "unverified" : "unavailable"')
    expect(source).toContain("previewCompositionEvidence.evidence.admittedUrl === space.runningAppUrl")
    expect(source).toContain("attestedPreviewComposition?.consumedArtifacts")
    expect(source).toContain("artifact.repositoryIdentity === repository.identity && artifact.sourceRevision === unit.git.revision")
    expect(source).not.toContain('state="running" runtime={null}')
  })
})
