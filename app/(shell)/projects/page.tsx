import { PageHeader } from "@/components/shell/page-header"
import { ProjectsWorkspacePanel } from "@/components/projects/projects-workspace-panel"

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Governed systems under WilliamOS command. Projects preserve context, evidence, blockers, and next moves without becoming task boards or execution surfaces."
      />
      <div className="p-6">
        <ProjectsWorkspacePanel />
      </div>
    </>
  )
}
