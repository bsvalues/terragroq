import type { CrossRepositoryChangeSetProjection } from "@/lib/environment/cross-repository-change-set"
import type { ChangeSetDeliveryUnit } from "./change-set-surface"

type RepositoryLabel = Readonly<{ key: string; label: string; role: string }>

export type ChangeSetSurfaceModel = Readonly<{
  outcome: string
  units: readonly ChangeSetDeliveryUnit[]
  limitations: readonly string[]
}>

function evidenceLabel(state: "pending" | "passed" | "failed", subject: string): string {
  if (state === "passed") return `${subject} passed`
  if (state === "failed") return `${subject} failed`
  return `${subject} pending`
}

function reviewLabel(state: "pending" | "approved" | "changes-requested"): string {
  if (state === "approved") return "Review approved"
  if (state === "changes-requested") return "Changes requested"
  return "Review pending"
}

export function changeSetSurfaceModel(
  projection: CrossRepositoryChangeSetProjection,
  repositories: readonly RepositoryLabel[],
): ChangeSetSurfaceModel {
  const repositoryByKey = new Map(repositories.map((repository) => [repository.key, repository]))
  const unitIdByWorkOrder = new Map(projection.units.map((unit) => [unit.workOrder.id, unit.id]))
  const producedByWorkOrder = new Map<number, string[]>()
  const consumedByWorkOrder = new Map<number, string[]>()
  const dependenciesByWorkOrder = new Map<number, string[]>()

  for (const dependency of projection.dependencies) {
    const identity = `${dependency.contractIdentity}@${dependency.revisionIdentity}`
    producedByWorkOrder.set(dependency.producerWorkOrderId, [
      ...(producedByWorkOrder.get(dependency.producerWorkOrderId) ?? []),
      identity,
    ])
    consumedByWorkOrder.set(dependency.consumerWorkOrderId, [
      ...(consumedByWorkOrder.get(dependency.consumerWorkOrderId) ?? []),
      identity,
    ])
    const producerId = unitIdByWorkOrder.get(dependency.producerWorkOrderId)
    if (producerId) {
      dependenciesByWorkOrder.set(dependency.consumerWorkOrderId, [
        ...(dependenciesByWorkOrder.get(dependency.consumerWorkOrderId) ?? []),
        producerId,
      ])
    }
  }

  return {
    outcome: projection.outcome?.title ?? "Current Space outcome",
    units: projection.units.map((unit): ChangeSetDeliveryUnit => {
      const repository = repositoryByKey.get(unit.repository.key)
      const produces = producedByWorkOrder.get(unit.workOrder.id) ?? []
      const consumes = consumedByWorkOrder.get(unit.workOrder.id) ?? []
      const dependsOn = dependenciesByWorkOrder.get(unit.workOrder.id) ?? []
      const state = unit.delivery.state === "sealed"
        ? "delivery-sealed" as const
        : unit.workOrder.status === "active" || unit.workOrder.status === "in_progress"
          ? "work-active" as const
          : "evidence-pending" as const
      return {
        id: unit.id,
        repositoryKey: unit.repository.key,
        repositoryName: repository?.label ?? unit.repository.identity,
        repositoryRole: repository?.role ?? "Core Seven repository",
        branch: unit.git.branch,
        revision: unit.git.revision,
        state,
        ...(unit.git.pullRequest ? { pullRequest: { number: unit.git.pullRequest, status: "recorded" as const } } : {}),
        tests: { status: unit.validation.state, label: evidenceLabel(unit.validation.state, "Validation") },
        review: { status: unit.review.state, label: reviewLabel(unit.review.state) },
        ...(produces[0] ? { produces: produces[0] } : {}),
        ...(consumes.length > 0 ? { consumes: [...new Set(consumes)] } : {}),
        ...(dependsOn.length > 0 ? { dependsOn: [...new Set(dependsOn)] } : {}),
        limitations: unit.limitations,
      }
    }),
    limitations: projection.limitations,
  }
}
