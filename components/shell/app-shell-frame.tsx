"use client"

import type { AuthReadiness } from "@/lib/auth-readiness"
import type { RuntimeStatus } from "@/lib/ai/runtime"
import type { ProjectView } from "@/lib/operator/operator-state"
import { WorkbenchShell } from "@/components/workbench/workbench-shell"

export function AppShellFrame({
  user,
  projects,
  projectState,
  pulse,
  readiness,
  runtime,
  observedAt,
  children,
}: {
  user: { id: string; name: string; email: string }
  projects: ProjectView[]
  projectState: "available" | "degraded"
  pulse: { working: number | null; needsYou: number | null; queueDepth: number | null }
  readiness: AuthReadiness
  runtime: RuntimeStatus
  observedAt: string
  children: React.ReactNode
}) {
  return (
    <WorkbenchShell
      user={user}
      projects={projects}
      projectState={projectState}
      pulse={pulse}
      readiness={readiness}
      runtime={runtime}
      observedAt={observedAt}
    >
      {children}
    </WorkbenchShell>
  )
}
