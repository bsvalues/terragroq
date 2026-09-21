"use client"

import { WorkspaceShell } from "@/components/workspace-shell/workspace-shell"
import type { SummonedSurface } from "@/lib/environment/summon"
import { DEFAULT_VISIBLE_WORKSPACE_PROJECTS, type VisibleWorkspaceProject, type WorkspaceProjectKey } from "@/lib/projects/workspace-project-key"

/** The root is one durable Space: independent work windows plus the transient universal Line. */
export function Desk({
  initialSummon = null,
  projectKey = "terrafusion",
  visibleProjects = DEFAULT_VISIBLE_WORKSPACE_PROJECTS,
}: {
  initialSummon?: SummonedSurface | null
  projectKey?: WorkspaceProjectKey
  visibleProjects?: readonly VisibleWorkspaceProject[]
} = {}) {
  return <WorkspaceShell key={projectKey} initialSummon={initialSummon} projectKey={projectKey} visibleProjects={visibleProjects} />
}
