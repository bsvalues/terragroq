-- Disposable/pre-write reversal only. After durable writes, use a reviewed forward fix or restore.
DROP TABLE IF EXISTS ai_evalops.outbox;
DROP FUNCTION IF EXISTS ai_evalops.enforce_current_outbox_lease();
DROP TABLE IF EXISTS ai_evalops.events;
DROP FUNCTION IF EXISTS ai_evalops.enforce_contiguous_event_chain();
ALTER TABLE ai_evalops.job_projection DROP CONSTRAINT IF EXISTS job_projection_receipt_fk;
DROP TABLE IF EXISTS ai_evalops.evidence_references;
DROP INDEX IF EXISTS ai_evalops.leases_one_active_per_effect_domain;
DROP TABLE IF EXISTS ai_evalops.leases;
DROP FUNCTION IF EXISTS ai_evalops.enforce_lease_transition();
DROP FUNCTION IF EXISTS ai_evalops.allocate_monotonic_lease_fence();
ALTER TABLE ai_evalops.job_projection DROP CONSTRAINT IF EXISTS job_projection_attempt_fk;
DROP TABLE IF EXISTS ai_evalops.attempts;
DROP TABLE IF EXISTS ai_evalops.workers;
DROP TABLE IF EXISTS ai_evalops.job_projection;
DROP TABLE IF EXISTS ai_evalops.jobs;
DROP TABLE IF EXISTS ai_evalops.effect_domain_fences;
DROP FUNCTION IF EXISTS ai_evalops.reject_immutable_control_mutation();
