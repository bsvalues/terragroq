-- Evidence: scripts/hermes-bridge/outcome-queue-source.mjs RECEIPT_CONSTRAINT_CONTRACTS expects only goal_outcome_intake_receipt_goalId_fkey; goal_outcome_intake_receipt_goalId_goal_id_fk is a redundant duplicate foreign key.
BEGIN;

ALTER TABLE public.goal_outcome_intake_receipt
  DROP CONSTRAINT IF EXISTS "goal_outcome_intake_receipt_goalId_goal_id_fk";

COMMIT;
