import { PageHeader } from "@/components/shell/page-header"
import { ProjectsWorkspacePanel } from "@/components/projects/projects-workspace-panel"
import { getOperatorState } from "@/lib/operator/operator-state"

export default async function ProjectsPage() {
  const state = await getOperatorState()

  return (
    <>
      <PageHeader
        title="Projects"
        description="Durable project identities and explicit resource bindings. Ambiguous operational records remain unassigned."
      />
      <div className="p-6">
        <ProjectsWorkspacePanel projects={state.projects} />
      </div>
    </>
  )
}
