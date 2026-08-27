import { notFound } from "next/navigation"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import { matchesW1FixtureToken, validateW1LocalFixtureHome, w1LocalFixtureConfig } from "@/lib/environment/w1-local-fixture"

export default async function W1LocalFixturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const config = w1LocalFixtureConfig()
  const supplied = (await searchParams).token
  if (!config || typeof supplied !== "string" || !matchesW1FixtureToken(supplied, config.token)) notFound()
  if (!(await validateW1LocalFixtureHome(config))) notFound()
  const token = encodeURIComponent(config.token)
  return (
    <WorkspaceShell
      endpoints={{
        space: `/api/w1-fixture/space?token=${token}`,
        files: `/api/w1-fixture/files?token=${token}`,
        directFixtureWrites: true,
      }}
      fixtureLabel="LOCAL W1 FIXTURE · isolated real files · no production auth or database"
    />
  )
}
