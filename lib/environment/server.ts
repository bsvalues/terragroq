import { getSession } from "@/lib/session"
import { postgresEnvironmentWorldRepository } from "@/lib/environment/postgres-world-repository"
import {
  createEnvironmentWorldService,
  type EnvironmentComparisonPort,
  type EnvironmentEndpointResolver,
  type EnvironmentEndpointLivenessPort,
} from "@/lib/environment/world-service"
import type { EnvironmentWorldDto } from "@/lib/environment/api-contract"
import { postgresEnvironmentWorkIntake } from "@/lib/environment/postgres-work-intake"
import { verifyEndpointLiveness } from "@/lib/environment/endpoint-liveness"

const productionEndpointLiveness: EnvironmentEndpointLivenessPort = {
  async refresh(endpoint) {
    return verifyEndpointLiveness({
      ...endpoint,
      provenance: {
        source: endpoint.provenance.source,
        evidenceRef: endpoint.provenance.evidenceRef,
        capturedAt: endpoint.provenance.capturedAt,
      },
    }, { sourceEvidenceRef: endpoint.provenance.evidenceRef })
  },
}

/**
 * Production deliberately starts without an execution or comparison adapter. Runtime integration
 * supplies those explicit ports; absence remains a waiting state and cannot degrade into demo data.
 */
export function createProductionEnvironmentService(options: {
  endpointResolver?: EnvironmentEndpointResolver
  comparisonPort?: EnvironmentComparisonPort
} = {}) {
  return createEnvironmentWorldService({
    repository: postgresEnvironmentWorldRepository,
    endpointResolver: options.endpointResolver,
    endpointLivenessPort: productionEndpointLiveness,
    comparisonPort: options.comparisonPort,
    workIntakePort: postgresEnvironmentWorkIntake,
  })
}

export const environmentWorldService = createProductionEnvironmentService()

/** Server-component seam. Null means unauthenticated or no restorable world; routes distinguish 401. */
export async function loadCurrentEnvironmentWorld(
  worldId?: string | null,
  authenticatedUserId?: string,
): Promise<EnvironmentWorldDto | null> {
  if (authenticatedUserId) return environmentWorldService.load(authenticatedUserId, worldId)
  try {
    const session = await getSession()
    return session?.user?.id ? environmentWorldService.load(session.user.id, worldId) : null
  } catch {
    return null
  }
}
