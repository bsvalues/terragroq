import { AppShellFrame } from "./app-shell-frame"
import { buildRuntimeStatus } from "@/lib/ai/runtime"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { getOperatorState } from "@/lib/operator/operator-state"

export async function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string }
  children: React.ReactNode
}) {
  const [readiness, runtime] = await Promise.all([
    getAuthReadiness({ probeDatabase: true }),
    Promise.resolve(buildRuntimeStatus()),
  ])
  let projects: Awaited<ReturnType<typeof getOperatorState>>["projects"]["value"] = []
  let pulse: { working: number | null; needsYou: number | null; queueDepth: number | null } = {
    working: null,
    needsYou: null,
    queueDepth: null,
  }
  if (readiness.databaseReady) {
    try {
      const operatorState = await getOperatorState()
      projects = operatorState.projects.value
      pulse = {
        working: operatorState.now.value.activeExecutions,
        needsYou: operatorState.needsWilliam.value.length,
        queueDepth: operatorState.now.value.queueDepth,
      }
    } catch {
      // The Workbench shell still renders truthful degraded state when a
      // supporting projection fails after the current readiness probe.
    }
  }

  return (
    <AppShellFrame
      user={user}
      projects={projects}
      pulse={pulse}
      readiness={readiness}
      runtime={runtime}
      observedAt={new Date().toISOString()}
    >
      {children}
    </AppShellFrame>
  )
}
