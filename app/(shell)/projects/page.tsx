import { PageHeader } from "@/components/shell/page-header"
import { ProjectsWorkspacePanel } from "@/components/projects/projects-workspace-panel"

export default function ProjectsPage() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Governed project systems inside WilliamOS. TerraFusion OS and future systems stay under Work Orders, Evidence, Systems checks, and authority boundaries."
      />
      <div className="p-6">
        <ProjectsWorkspacePanel />
      </div>
    </>
  )
}
