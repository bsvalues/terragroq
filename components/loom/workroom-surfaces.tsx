"use client"

import { AgentThread } from "@/components/loom/agent-thread"
import { LiveConsole } from "@/components/loom/live-console"
import { Workspace } from "@/components/loom/workspace"
import { useWorkbenchContext } from "@/components/workbench/workbench-context"

type SupportedProjectKey = "terrafusion" | "williamos"

function supportedProjectKey(value: string | null | undefined): SupportedProjectKey | null {
  return value === "terrafusion" || value === "williamos" ? value : null
}

/**
 * Binds every live Workroom surface to one canonical selected project.
 *
 * The shared key deliberately remounts the surfaces when the project changes. That fences pending
 * file, diff, agent, and terminal results inside the checkout that originated them instead of
 * allowing an old request to repopulate the newly selected project.
 */
export function WorkroomSurfaces() {
  const workbench = useWorkbenchContext()
  const selected = workbench?.selectedProject ?? null
  const projectKey = supportedProjectKey(selected?.key)

  if (!selected || !projectKey) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border p-8">
        <div className="max-w-md text-center">
          <h2 className="text-sm font-medium">This project is not available in Workroom</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Select the WilliamOS or TerraFusion project to open its files, agent, and live operations.
            Nothing was opened or changed.
          </p>
        </div>
      </section>
    )
  }

  const identity = `${selected.id}:${projectKey}`
  return (
    <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[3fr_2fr]" data-project-key={projectKey}>
      <Workspace key={`workspace:${identity}`} projectKey={projectKey} />
      <div className="flex min-h-0 flex-col gap-3">
        <AgentThread key={`agent:${identity}`} projectKey={projectKey} />
        <LiveConsole key={`console:${identity}`} projectKey={projectKey} />
      </div>
    </div>
  )
}
