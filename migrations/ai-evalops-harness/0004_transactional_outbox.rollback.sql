DROP FUNCTION IF EXISTS ai_evalops.record_dispatch_outcome(uuid,uuid,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS ai_evalops.claim_outbox_dispatch(uuid,interval);
DROP FUNCTION IF EXISTS ai_evalops.enqueue_effect(uuid,uuid,uuid,text,text,bigint,text,bigint,uuid);
DROP TABLE IF EXISTS ai_evalops.effect_delivery_receipts;
DROP TABLE IF EXISTS ai_evalops.outbox_operation_receipts;
ALTER TABLE ai_evalops.outbox DROP COLUMN IF EXISTS dispatch_started_at,DROP COLUMN IF EXISTS dispatch_operation_id,DROP COLUMN IF EXISTS dispatch_attempts,DROP COLUMN IF EXISTS dispatch_state;
