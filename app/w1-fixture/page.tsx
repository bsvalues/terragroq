import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { w1LocalFixtureConfig } from "@/lib/environment/w1-local-fixture"

export default function W1LocalFixturePage() {
  if (!w1LocalFixtureConfig()) notFound()
  return (
    <WorkspaceShell
      endpoints={{
        space: "/api/w1-fixture/space",
        files: "/api/w1-fixture/files",
        directFixtureWrites: true,
      }}
      fixtureLabel="LOCAL W1 FIXTURE · isolated real files · no production auth or database"
    />
  )
}
