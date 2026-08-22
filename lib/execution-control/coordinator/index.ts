import { pullEligibleJob, type ClaimReceipt, type ClaimRequest, type QueryExecutor } from "../claim-lease-engine"

export { CoordinatorContractError, createCoordinator, validateCoordinatorConfig } from "./core.mjs"

// This adapter is the only work-pull binding. It deliberately consumes WO-AEH-016's typed engine;
// reconciliation remains a separately injected WO-AEH-019 dependency and is not implemented here.
export async function pullThroughClaimLeaseEngine(
  executor: QueryExecutor,
  request: Omit<ClaimRequest, "jobId">,
): Promise<ClaimReceipt> {
  return pullEligibleJob(executor, request)
}
