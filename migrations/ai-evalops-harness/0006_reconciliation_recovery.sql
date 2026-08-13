-- WO-AEH-019 historical-descriptor reconciliation. Disposable validation only.
CREATE TABLE ai_evalops.reconciliation_receipts (
  operation_id uuid PRIMARY KEY,
  descriptor_id uuid NOT NULL,
  descriptor_digest text NOT NULL,
  actor_id text NOT NULL CHECK (actor_id ~ '^[A-Za-z0-9:_-]{3,128}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[a-f0-9]{64}$'),
  observation_evidence_id uuid NOT NULL,
  observation_evidence_digest text NOT NULL CHECK (observation_evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  terminal_receipt_evidence_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED')),
  result text NOT NULL CHECK (result IN ('RETRY_SAFE','TERMINAL_EXECUTED','BLOCKED_AMBIGUOUS','TERMINAL_EXPIRED','TERMINAL_FENCED')),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  event_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (descriptor_id,descriptor_digest) REFERENCES ai_evalops.settlement_descriptors(descriptor_id,descriptor_digest),
  FOREIGN KEY (observation_evidence_id) REFERENCES ai_evalops.evidence_references(evidence_id),
  FOREIGN KEY (terminal_receipt_evidence_id) REFERENCES ai_evalops.evidence_references(evidence_id)
);
CREATE TRIGGER reconciliation_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.reconciliation_receipts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE FUNCTION ai_evalops.reconcile_recovery(
  p_operation_id uuid,p_descriptor_id uuid,p_descriptor_digest text,p_actor_id text,
  p_authority_digest text,p_capability_digest text,p_observation_evidence_id uuid,p_observation_evidence_digest text,
  p_terminal_receipt_evidence_id uuid,p_terminal_receipt_evidence_digest text,p_outcome text,p_expected_version bigint
) RETURNS ai_evalops.reconciliation_receipts LANGUAGE plpgsql AS $$
DECLARE r ai_evalops.reconciliation_receipts%ROWTYPE; d ai_evalops.settlement_descriptors%ROWTYPE;
DECLARE p ai_evalops.job_projection%ROWTYPE; req text; res text; next_state text; terminal boolean;
DECLARE seq bigint; prior text; ev uuid:=gen_random_uuid(); ev_digest text; lease_row ai_evalops.leases%ROWTYPE;
DECLARE authority_row ai_evalops.authority_status%ROWTYPE; capability_row ai_evalops.worker_capability_status%ROWTYPE;
BEGIN
  req:=ai_evalops.canonical_operation_digest(jsonb_build_object('actor_id',p_actor_id,'authority_digest',p_authority_digest,
    'capability_digest',p_capability_digest,'descriptor_digest',p_descriptor_digest,'descriptor_id',p_descriptor_id,
    'expected_version',p_expected_version,'observation_evidence_digest',p_observation_evidence_digest,
    'observation_evidence_id',p_observation_evidence_id,'outcome',p_outcome,'terminal_receipt_evidence_digest',p_terminal_receipt_evidence_digest,'terminal_receipt_evidence_id',p_terminal_receipt_evidence_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO r FROM ai_evalops.reconciliation_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN IF r.request_digest<>req THEN RAISE EXCEPTION 'RECONCILIATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF; RETURN r; END IF;
  IF p_outcome NOT IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED') OR p_expected_version<0 THEN RAISE EXCEPTION 'RECONCILIATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM ai_evalops.settlement_descriptors WHERE descriptor_id=p_descriptor_id AND descriptor_digest=p_descriptor_digest;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECONCILIATION_DESCRIPTOR_INVALID' USING ERRCODE='55000'; END IF;
  IF d.authority_digest<>p_authority_digest OR d.capability_digest<>p_capability_digest THEN RAISE EXCEPTION 'RECONCILIATION_IDENTITY_INVALID' USING ERRCODE='55000'; END IF;
  -- Global order: effect-domain advisory lock, capability, authority, projection,
  -- lease/fence, then outbox/effect rows.  WO017 mutators take the same domain
  -- lock before changing dispatch state, closing predicate/update TOCTOU gaps.
  PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||d.effect_domain,0));
  SELECT * INTO capability_row FROM ai_evalops.worker_capability_status WHERE worker_id=d.holder_worker_id AND instance_id=d.holder_instance_id AND boot_id=d.boot_id AND capability_digest=p_capability_digest FOR UPDATE;
  IF NOT FOUND OR capability_row.status<>'FRESH' OR capability_row.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'CAPABILITY_NOT_FRESH' USING ERRCODE='55000'; END IF;
  SELECT * INTO authority_row FROM ai_evalops.authority_status WHERE authority_digest=p_authority_digest FOR UPDATE;
  IF NOT FOUND OR authority_row.status<>'ACTIVE' OR authority_row.revoked_at IS NOT NULL OR authority_row.valid_until<=clock_timestamp() THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000'; END IF;
  SELECT * INTO p FROM ai_evalops.job_projection WHERE job_id=d.job_id FOR UPDATE;
  IF p.state<>'RECONCILING' OR p.current_attempt_id IS DISTINCT FROM d.attempt_id OR p.version<>p_expected_version THEN RAISE EXCEPTION 'RECONCILIATION_PROJECTION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM ai_evalops.evidence_references WHERE evidence_id=p_observation_evidence_id AND evidence_type='RECOVERY_OBSERVATION' AND content_digest=p_observation_evidence_digest) THEN RAISE EXCEPTION 'RECONCILIATION_OBSERVATION_INVALID' USING ERRCODE='55000'; END IF;
  SELECT * INTO lease_row FROM ai_evalops.leases WHERE lease_id=d.lease_id AND attempt_id=d.attempt_id AND fencing_token=d.fencing_token FOR UPDATE;
  PERFORM 1 FROM ai_evalops.effect_domain_fences WHERE effect_domain=d.effect_domain FOR UPDATE;
  PERFORM 1 FROM ai_evalops.outbox WHERE job_id=d.job_id AND attempt_id=d.attempt_id ORDER BY outbox_id FOR UPDATE;
  PERFORM 1 FROM ai_evalops.effect_delivery_receipts e WHERE EXISTS
    (SELECT 1 FROM ai_evalops.outbox o WHERE o.job_id=d.job_id AND o.attempt_id=d.attempt_id
      AND o.effect_domain=e.effect_domain AND o.idempotency_key=e.idempotency_key)
    ORDER BY effect_domain,idempotency_key FOR UPDATE;
  IF p_outcome='EXPIRED' AND NOT (d.expires_at<=clock_timestamp() OR lease_row.expires_at<=clock_timestamp() OR lease_row.release_reason='EXPIRED') THEN RAISE EXCEPTION 'OUTCOME_NOT_DB_GROUNDED' USING ERRCODE='55000'; END IF;
  IF p_outcome='FENCED' AND NOT (lease_row.release_reason='FENCED' OR EXISTS (SELECT 1 FROM ai_evalops.effect_domain_fences WHERE effect_domain=d.effect_domain AND next_fencing_token>d.fencing_token+1)) THEN RAISE EXCEPTION 'OUTCOME_NOT_DB_GROUNDED' USING ERRCODE='55000'; END IF;
  IF p_outcome='NOT_EXECUTED' AND (EXISTS (SELECT 1 FROM ai_evalops.outbox WHERE job_id=d.job_id AND attempt_id=d.attempt_id AND dispatch_state IN ('DISPATCHING','DELIVERED','AMBIGUOUS')) OR EXISTS (SELECT 1 FROM ai_evalops.outbox o JOIN ai_evalops.effect_delivery_receipts e ON e.effect_domain=o.effect_domain AND e.idempotency_key=o.idempotency_key WHERE o.job_id=d.job_id AND o.attempt_id=d.attempt_id)) THEN RAISE EXCEPTION 'NOT_EXECUTED_EFFECT_STATE_CONFLICT' USING ERRCODE='55000'; END IF;
  IF p_outcome='AMBIGUOUS' AND EXISTS (SELECT 1 FROM ai_evalops.outbox o JOIN ai_evalops.effect_delivery_receipts e ON e.effect_domain=o.effect_domain AND e.idempotency_key=o.idempotency_key WHERE o.job_id=d.job_id AND o.attempt_id=d.attempt_id AND e.outcome='DELIVERED') THEN RAISE EXCEPTION 'AMBIGUOUS_DELIVERED_CONFLICT' USING ERRCODE='55000'; END IF;
  terminal:=p_outcome IN ('EXECUTED','EXPIRED','FENCED');
  IF terminal AND NOT EXISTS (SELECT 1 FROM ai_evalops.evidence_references WHERE evidence_id=p_terminal_receipt_evidence_id AND evidence_type='TERMINAL_RECEIPT' AND content_digest=p_terminal_receipt_evidence_digest) THEN RAISE EXCEPTION 'TERMINAL_RECEIPT_REQUIRED' USING ERRCODE='55000'; END IF;
  IF NOT terminal AND (p_terminal_receipt_evidence_id IS NOT NULL OR p_terminal_receipt_evidence_digest IS NOT NULL) THEN RAISE EXCEPTION 'TERMINAL_RECEIPT_FORBIDDEN' USING ERRCODE='55000'; END IF;
  IF p_outcome='EXECUTED' AND NOT EXISTS (SELECT 1 FROM ai_evalops.outbox o JOIN ai_evalops.effect_delivery_receipts e ON e.effect_domain=o.effect_domain AND e.idempotency_key=o.idempotency_key WHERE o.job_id=d.job_id AND o.attempt_id=d.attempt_id AND o.fencing_token=d.fencing_token AND o.dispatch_state='DELIVERED' AND e.outcome='DELIVERED' AND e.receipt_evidence_id=p_terminal_receipt_evidence_id) THEN RAISE EXCEPTION 'EXECUTED_OUTBOX_RECEIPT_REQUIRED' USING ERRCODE='55000'; END IF;
  res:=CASE p_outcome WHEN 'NOT_EXECUTED' THEN 'RETRY_SAFE' WHEN 'EXECUTED' THEN 'TERMINAL_EXECUTED' WHEN 'AMBIGUOUS' THEN 'BLOCKED_AMBIGUOUS' WHEN 'EXPIRED' THEN 'TERMINAL_EXPIRED' ELSE 'TERMINAL_FENCED' END;
  next_state:=CASE WHEN p_outcome='NOT_EXECUTED' THEN 'ADMITTED' WHEN p_outcome='AMBIGUOUS' THEN 'RECONCILING' ELSE 'TERMINAL' END;
  UPDATE ai_evalops.job_projection SET state=next_state,current_attempt_id=CASE WHEN p_outcome='NOT_EXECUTED' THEN NULL ELSE d.attempt_id END,
    terminal_classification=CASE WHEN terminal THEN p_outcome ELSE NULL END,terminal_receipt_evidence_id=CASE WHEN terminal THEN p_terminal_receipt_evidence_id ELSE NULL END,
    terminal_receipt_evidence_type=CASE WHEN terminal THEN 'TERMINAL_RECEIPT' ELSE NULL END,version=version+1,updated_at=clock_timestamp() WHERE job_id=d.job_id;
  IF terminal THEN INSERT INTO ai_evalops.settlement_receipts(operation_id,descriptor_id,descriptor_digest,outcome,evidence_id,request_digest)
    VALUES(p_operation_id,p_descriptor_id,p_descriptor_digest,p_outcome,p_terminal_receipt_evidence_id,req); END IF;
  PERFORM 1 FROM ai_evalops.jobs WHERE job_id=d.job_id FOR UPDATE;
  SELECT COALESCE(max(sequence),0)+1 INTO seq FROM ai_evalops.events WHERE job_id=d.job_id;
  SELECT event_digest INTO prior FROM ai_evalops.events WHERE job_id=d.job_id AND sequence=seq-1;
  ev_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('descriptor_digest',p_descriptor_digest,'event','RECOVERY_RECONCILED','observation',p_observation_evidence_digest,'outcome',p_outcome,'result',res));
  INSERT INTO ai_evalops.events(event_id,job_id,attempt_id,sequence,event_type,actor_id,authority_digest,prior_event_digest,event_digest,evidence_id)
    VALUES(ev,d.job_id,d.attempt_id,seq,'RECOVERY_RECONCILED',p_actor_id,p_authority_digest,prior,ev_digest,p_observation_evidence_id);
  INSERT INTO ai_evalops.reconciliation_receipts(operation_id,descriptor_id,descriptor_digest,actor_id,authority_digest,capability_digest,
    observation_evidence_id,observation_evidence_digest,terminal_receipt_evidence_id,outcome,result,request_digest,projection_version,event_id)
    VALUES(p_operation_id,p_descriptor_id,p_descriptor_digest,p_actor_id,p_authority_digest,p_capability_digest,p_observation_evidence_id,
      p_observation_evidence_digest,p_terminal_receipt_evidence_id,p_outcome,res,req,p.version+1,ev) RETURNING * INTO r;
  RETURN r;
END $$;
