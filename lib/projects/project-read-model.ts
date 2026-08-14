import type { ProjectResource, ProjectView } from "@/lib/operator/operator-state"

export type ProjectRow = {
  id: number
  userId: string
  key: string
  name: string
  lifecycle: string
}

export type ProjectResourceRow = {
  userId: string
  projectId: number
  type: string
  canonicalIdentity: string
  label: string
  relationship: string
}

const LIFECYCLES = new Set<ProjectView["lifecycle"]>(["active", "standby", "archived"])
const RESOURCE_TYPES = new Set<ProjectResource["type"]>([
  "repo",
  "database",
  "node",
  "service",
  "data_source",
])

export function projectRowsToViews(
  projectRows: ProjectRow[],
  resourceRows: ProjectResourceRow[],
  userId: string,
): ProjectView[] {
  const visibleProjects = projectRows
    .filter((row) => row.userId === userId && LIFECYCLES.has(row.lifecycle as ProjectView["lifecycle"]))
    .sort((left, right) => left.key.localeCompare(right.key))
  const visibleProjectIds = new Set(visibleProjects.map((row) => row.id))

  const resourcesByProject = new Map<number, ProjectResource[]>()
  for (const row of resourceRows) {
    if (
      row.userId !== userId ||
      !visibleProjectIds.has(row.projectId) ||
      !RESOURCE_TYPES.has(row.type as ProjectResource["type"])
    ) {
      continue
    }
    const resources = resourcesByProject.get(row.projectId) ?? []
    resources.push({
      type: row.type as ProjectResource["type"],
      canonicalIdentity: row.canonicalIdentity,
      label: row.label,
      relationship: row.relationship,
    })
    resourcesByProject.set(row.projectId, resources)
  }

  for (const resources of resourcesByProject.values()) {
    resources.sort((left, right) =>
      `${left.type}:${left.canonicalIdentity}:${left.relationship}`.localeCompare(
        `${right.type}:${right.canonicalIdentity}:${right.relationship}`,
      ),
    )
  }

  return visibleProjects.map((row) => ({
    key: row.key,
    name: row.name,
    lifecycle: row.lifecycle as ProjectView["lifecycle"],
    resources: resourcesByProject.get(row.id) ?? [],
  }))
}
