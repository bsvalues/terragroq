-- WO-AEH-017 transactional outbox and simulated effect-delivery idempotency.
ALTER TABLE ai_evalops.outbox ADD COLUMN dispatch_state text NOT NULL DEFAULT 'PENDING'
  CHECK (dispatch_state IN ('PENDING','DISPATCHING','AMBIGUOUS','DELIVERED')),
  ADD COLUMN dispatch_attempts bigint NOT NULL DEFAULT 0 CHECK(dispatch_attempts>=0),
  ADD COLUMN dispatch_operation_id uuid, ADD COLUMN dispatch_started_at timestamptz;

CREATE TABLE ai_evalops.outbox_operation_receipts(
  operation_id uuid PRIMARY KEY, operation_kind text NOT NULL CHECK(operation_kind IN ('ENQUEUE','CLAIM_DISPATCH','RECORD_OUTCOME')),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'), response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER outbox_operation_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.outbox_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE TABLE ai_evalops.effect_delivery_receipts(
  effect_domain text NOT NULL,idempotency_key text NOT NULL,payload_digest text NOT NULL,fencing_token bigint NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('DELIVERED','AMBIGUOUS')),receipt_evidence_id uuid REFERENCES ai_evalops.evidence_references(evidence_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(effect_domain,idempotency_key));
CREATE TRIGGER effect_delivery_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.effect_delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE FUNCTION ai_evalops.enqueue_effect(p_outbox_id uuid,p_job_id uuid,p_attempt_id uuid,p_effect_domain text,p_idempotency_key text,p_fence bigint,p_payload_digest text,p_expected_version bigint,p_operation_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d text; r ai_evalops.outbox_operation_receipts%ROWTYPE;
BEGIN d:=ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',p_attempt_id,'effect_domain',p_effect_domain,'fence',p_fence,'idempotency_key',p_idempotency_key,'job_id',p_job_id,'outbox_id',p_outbox_id,'payload_digest',p_payload_digest,'version',p_expected_version));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); SELECT * INTO r FROM ai_evalops.outbox_operation_receipts WHERE operation_id=p_operation_id;
 IF FOUND THEN IF r.operation_kind<>'ENQUEUE' OR r.request_digest<>d THEN RAISE EXCEPTION 'OUTBOX_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF; RETURN (r.response->>'outbox_id')::uuid; END IF;
 PERFORM 1 FROM ai_evalops.job_projection WHERE job_id=p_job_id AND current_attempt_id=p_attempt_id AND version=p_expected_version AND state IN('CLAIMED','RUNNING') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PROJECTION_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||p_effect_domain,0));
 PERFORM ai_evalops.validate_current_fence(l.lease_id,l.attempt_id,l.holder_worker_id,l.holder_instance_id,l.boot_id,l.fencing_token,j.authority_digest,w.capability_digest) FROM ai_evalops.leases l JOIN ai_evalops.attempts a USING(attempt_id) JOIN ai_evalops.jobs j USING(job_id) JOIN ai_evalops.workers w ON w.worker_id=l.holder_worker_id WHERE l.attempt_id=p_attempt_id AND l.effect_domain=p_effect_domain AND l.fencing_token=p_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_FENCE_NOT_CURRENT' USING ERRCODE='55000'; END IF;
 UPDATE ai_evalops.job_projection SET state='RUNNING',version=version+1,updated_at=clock_timestamp() WHERE job_id=p_job_id AND current_attempt_id=p_attempt_id AND version=p_expected_version AND state IN('CLAIMED','RUNNING');
 IF NOT FOUND THEN RAISE EXCEPTION 'PROJECTION_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO ai_evalops.outbox(outbox_id,job_id,attempt_id,effect_domain,idempotency_key,fencing_token,payload_digest) VALUES(p_outbox_id,p_job_id,p_attempt_id,p_effect_domain,p_idempotency_key,p_fence,p_payload_digest);
 INSERT INTO ai_evalops.outbox_operation_receipts VALUES(p_operation_id,'ENQUEUE',d,jsonb_build_object('outbox_id',p_outbox_id),clock_timestamp()); RETURN p_outbox_id; END $$;

CREATE FUNCTION ai_evalops.claim_outbox_dispatch(p_operation_id uuid,p_stale_after interval)
RETURNS TABLE(outbox_id uuid,effect_domain text,idempotency_key text,payload_digest text,fencing_token bigint,dispatch_state text) LANGUAGE plpgsql AS $$
DECLARE d text; r ai_evalops.outbox_operation_receipts%ROWTYPE; o ai_evalops.outbox%ROWTYPE; candidate_id uuid; candidate_domain text;
BEGIN d:=ai_evalops.canonical_operation_digest(jsonb_build_object('stale_seconds',extract(epoch from p_stale_after)));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0)); SELECT * INTO r FROM ai_evalops.outbox_operation_receipts WHERE operation_id=p_operation_id;
 IF FOUND THEN IF r.operation_kind<>'CLAIM_DISPATCH' OR r.request_digest<>d THEN RAISE EXCEPTION 'OUTBOX_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF; candidate_id:=(r.response->>'outbox_id')::uuid; SELECT x.effect_domain INTO candidate_domain FROM ai_evalops.outbox x WHERE x.outbox_id=candidate_id; PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||candidate_domain,0)); SELECT * INTO o FROM ai_evalops.outbox x WHERE x.outbox_id=candidate_id FOR UPDATE; PERFORM ai_evalops.validate_current_fence(l.lease_id,l.attempt_id,l.holder_worker_id,l.holder_instance_id,l.boot_id,l.fencing_token,j.authority_digest,w.capability_digest) FROM ai_evalops.leases l JOIN ai_evalops.attempts a USING(attempt_id) JOIN ai_evalops.jobs j USING(job_id) JOIN ai_evalops.workers w ON w.worker_id=l.holder_worker_id WHERE l.attempt_id=o.attempt_id AND l.effect_domain=o.effect_domain AND l.fencing_token=o.fencing_token; IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_FENCE_NOT_CURRENT' USING ERRCODE='55000'; END IF; IF o.dispatch_state IN('DELIVERED','AMBIGUOUS') THEN RETURN QUERY SELECT o.outbox_id,NULL::text,NULL::text,NULL::text,o.fencing_token,o.dispatch_state; RETURN; END IF; RETURN QUERY SELECT o.outbox_id,o.effect_domain,o.idempotency_key,o.payload_digest,o.fencing_token,o.dispatch_state; RETURN; END IF;
 SELECT * INTO o FROM ai_evalops.outbox x WHERE (x.dispatch_state='PENDING' OR (x.dispatch_state='DISPATCHING' AND x.dispatch_started_at<clock_timestamp()-p_stale_after)) ORDER BY x.created_at,x.outbox_id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_EMPTY' USING ERRCODE='55000'; END IF;
 candidate_id:=o.outbox_id; candidate_domain:=o.effect_domain;
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||candidate_domain,0));
 SELECT * INTO o FROM ai_evalops.outbox x WHERE x.outbox_id=candidate_id AND (x.dispatch_state='PENDING' OR (x.dispatch_state='DISPATCHING' AND x.dispatch_started_at<clock_timestamp()-p_stale_after)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_EMPTY' USING ERRCODE='55000'; END IF;
 PERFORM ai_evalops.validate_current_fence(l.lease_id,l.attempt_id,l.holder_worker_id,l.holder_instance_id,l.boot_id,l.fencing_token,j.authority_digest,w.capability_digest) FROM ai_evalops.leases l JOIN ai_evalops.attempts a USING(attempt_id) JOIN ai_evalops.jobs j USING(job_id) JOIN ai_evalops.workers w ON w.worker_id=l.holder_worker_id WHERE l.attempt_id=o.attempt_id AND l.effect_domain=o.effect_domain AND l.fencing_token=o.fencing_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_FENCE_NOT_CURRENT' USING ERRCODE='55000'; END IF;
 UPDATE ai_evalops.outbox x SET dispatch_state='DISPATCHING',dispatch_attempts=x.dispatch_attempts+1,dispatch_operation_id=p_operation_id,dispatch_started_at=clock_timestamp() WHERE x.outbox_id=o.outbox_id;
 INSERT INTO ai_evalops.outbox_operation_receipts VALUES(p_operation_id,'CLAIM_DISPATCH',d,jsonb_build_object('outbox_id',o.outbox_id,'effect_domain',o.effect_domain,'idempotency_key',o.idempotency_key,'payload_digest',o.payload_digest,'fencing_token',o.fencing_token),clock_timestamp());
 RETURN QUERY SELECT o.outbox_id,o.effect_domain,o.idempotency_key,o.payload_digest,o.fencing_token,'DISPATCHING'::text; END $$;

CREATE FUNCTION ai_evalops.record_dispatch_outcome(p_outbox_id uuid,p_claim_operation_id uuid,p_operation_id uuid,p_outcome text,p_evidence_id uuid,p_evidence_digest text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE d text;r ai_evalops.outbox_operation_receipts%ROWTYPE;o ai_evalops.outbox%ROWTYPE;e ai_evalops.effect_delivery_receipts%ROWTYPE;
BEGIN d:=ai_evalops.canonical_operation_digest(jsonb_build_object('claim_operation_id',p_claim_operation_id,'evidence_digest',p_evidence_digest,'evidence_id',p_evidence_id,'outbox_id',p_outbox_id,'outcome',p_outcome));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));SELECT * INTO r FROM ai_evalops.outbox_operation_receipts WHERE operation_id=p_operation_id;
 IF FOUND THEN IF r.operation_kind<>'RECORD_OUTCOME' OR r.request_digest<>d THEN RAISE EXCEPTION 'OUTBOX_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002';END IF;RETURN r.response->>'result';END IF;
 IF p_outcome NOT IN('DELIVERED','AMBIGUOUS') THEN RAISE EXCEPTION 'OUTBOX_OUTCOME_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM ai_evalops.outbox WHERE outbox_id=p_outbox_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_CLAIM_STALE' USING ERRCODE='55000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||o.effect_domain,0));
 SELECT * INTO o FROM ai_evalops.outbox WHERE outbox_id=p_outbox_id AND dispatch_state='DISPATCHING' AND dispatch_operation_id=p_claim_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_CLAIM_STALE' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.evidence_references WHERE evidence_id=p_evidence_id AND content_digest=p_evidence_digest AND evidence_type=CASE WHEN p_outcome='DELIVERED' THEN 'TERMINAL_RECEIPT' ELSE 'RECOVERY_OBSERVATION' END) THEN RAISE EXCEPTION 'OUTBOX_EVIDENCE_INVALID' USING ERRCODE='55000';END IF;
 SELECT * INTO e FROM ai_evalops.effect_delivery_receipts WHERE effect_domain=o.effect_domain AND idempotency_key=o.idempotency_key;
 IF FOUND AND (e.payload_digest<>o.payload_digest OR e.fencing_token<>o.fencing_token) THEN RAISE EXCEPTION 'EFFECT_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002';END IF;
 IF NOT FOUND THEN INSERT INTO ai_evalops.effect_delivery_receipts VALUES(o.effect_domain,o.idempotency_key,o.payload_digest,o.fencing_token,p_outcome,p_evidence_id,clock_timestamp()); END IF;
 UPDATE ai_evalops.outbox SET dispatch_state=CASE WHEN p_outcome='DELIVERED' THEN 'DELIVERED' ELSE 'AMBIGUOUS' END,delivered_at=CASE WHEN p_outcome='DELIVERED' THEN clock_timestamp() ELSE NULL END,receipt_evidence_id=p_evidence_id WHERE outbox_id=p_outbox_id;
 INSERT INTO ai_evalops.outbox_operation_receipts VALUES(p_operation_id,'RECORD_OUTCOME',d,jsonb_build_object('result',p_outcome),clock_timestamp());RETURN p_outcome;END $$;
