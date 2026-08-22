-- Disposable/pre-use reversal only.
DROP FUNCTION IF EXISTS ai_evalops.reconcile_expiry(uuid,uuid,uuid,text,text,uuid,text,text,bigint);
DROP FUNCTION IF EXISTS ai_evalops.validate_current_fence(uuid,uuid,uuid,uuid,uuid,bigint,text,text);
DROP FUNCTION IF EXISTS ai_evalops.expire_lease(uuid,uuid);
DROP FUNCTION IF EXISTS ai_evalops.release_lease(uuid,uuid,uuid,uuid,uuid,bigint,bigint,uuid,text);
DROP FUNCTION IF EXISTS ai_evalops.renew_lease(uuid,uuid,uuid,uuid,uuid,bigint,bigint,uuid,interval);
DROP FUNCTION IF EXISTS ai_evalops.pull_next_job(uuid,uuid,uuid,uuid,uuid,uuid,interval);
DROP FUNCTION IF EXISTS ai_evalops.claim_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,interval);
DROP FUNCTION IF EXISTS ai_evalops.canonical_operation_digest(jsonb);
DROP TABLE IF EXISTS ai_evalops.worker_capability_status;
DROP TABLE IF EXISTS ai_evalops.authority_status;
DROP TABLE IF EXISTS ai_evalops.lease_operation_receipts;
