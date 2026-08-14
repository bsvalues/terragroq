import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { project, projectResource } from "@/lib/db/schema"
import { projectRowsToViews } from "@/lib/projects/project-read-model"
import type { ProjectView } from "@/lib/operator/operator-state"

export async function loadProjects(userId: string): Promise<ProjectView[]> {
  const projects = await db
    .select({
      id: project.id,
      userId: project.userId,
      key: project.key,
      name: project.name,
      lifecycle: project.lifecycle,
    })
    .from(project)
    .where(eq(project.userId, userId))

  const resources = await db
    .select({
      userId: projectResource.userId,
      projectId: projectResource.projectId,
      type: projectResource.type,
      canonicalIdentity: projectResource.canonicalIdentity,
      label: projectResource.label,
      relationship: projectResource.relationship,
    })
    .from(projectResource)
    .where(eq(projectResource.userId, userId))

  return projectRowsToViews(projects, resources, userId)
}
