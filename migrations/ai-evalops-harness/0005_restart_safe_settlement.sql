-- WO-AEH-018 durable authenticated settlement descriptors. Disposable validation only.
CREATE TABLE ai_evalops.settlement_descriptors (
  descriptor_id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  run_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  effect_domain text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  holder_worker_id uuid NOT NULL,
  holder_instance_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  descriptor_digest text NOT NULL UNIQUE CHECK (descriptor_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (descriptor_id, descriptor_digest),
  FOREIGN KEY (job_id, attempt_id) REFERENCES ai_evalops.attempts(job_id, attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, effect_domain, fencing_token) REFERENCES ai_evalops.leases(attempt_id, effect_domain, fencing_token) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);

CREATE TRIGGER settlement_descriptors_immutable BEFORE UPDATE OR DELETE ON ai_evalops.settlement_descriptors
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE TABLE ai_evalops.settlement_receipts (
  operation_id uuid PRIMARY KEY,
  descriptor_id uuid NOT NULL,
  descriptor_digest text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED')),
  evidence_id uuid NOT NULL,
  evidence_type text NOT NULL DEFAULT 'TERMINAL_RECEIPT' CHECK (evidence_type='TERMINAL_RECEIPT'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  settled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (descriptor_id, descriptor_digest) REFERENCES ai_evalops.settlement_descriptors(descriptor_id, descriptor_digest) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id, evidence_type) REFERENCES ai_evalops.evidence_references(evidence_id, evidence_type) ON DELETE RESTRICT
);

CREATE TRIGGER settlement_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.settlement_receipts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE FUNCTION ai_evalops.issue_settlement_descriptor(
  p_descriptor_id uuid,p_job_id uuid,p_attempt_id uuid,p_run_id uuid,p_claim_id uuid,p_lease_id uuid,
  p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint
) RETURNS ai_evalops.settlement_descriptors LANGUAGE plpgsql AS $$
DECLARE v_row ai_evalops.settlement_descriptors%ROWTYPE; v_digest text;
BEGIN
  SELECT p_descriptor_id,j.job_id,a.attempt_id,p_run_id,a.claim_id,l.lease_id,l.effect_domain,l.fencing_token,
    l.holder_worker_id,l.holder_instance_id,l.boot_id,j.authority_digest,w.capability_digest,j.input_digest,
    LEAST(l.expires_at,j.admission_expires_at),NULL,clock_timestamp()
    INTO v_row
    FROM ai_evalops.jobs j JOIN ai_evalops.attempts a ON a.job_id=j.job_id
    JOIN ai_evalops.leases l ON l.attempt_id=a.attempt_id
    JOIN ai_evalops.workers w ON w.worker_id=l.holder_worker_id AND w.instance_id=l.holder_instance_id AND w.boot_id=l.boot_id
    JOIN ai_evalops.authority_status s ON s.authority_digest=j.authority_digest
    JOIN ai_evalops.worker_capability_status c ON c.worker_id=w.worker_id AND c.instance_id=w.instance_id AND c.boot_id=w.boot_id AND c.capability_digest=w.capability_digest
    WHERE j.job_id=p_job_id AND a.attempt_id=p_attempt_id AND a.claim_id=p_claim_id AND l.lease_id=p_lease_id
      AND l.holder_worker_id=p_worker_id AND l.holder_instance_id=p_instance_id AND l.boot_id=p_boot_id AND l.fencing_token=p_fence
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND w.retired_at IS NULL
      AND s.status='ACTIVE' AND s.revoked_at IS NULL AND s.valid_until>clock_timestamp()
      AND c.status='FRESH' AND c.valid_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_DESCRIPTOR_BINDING_INVALID' USING ERRCODE='55000'; END IF;
  v_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',v_row.attempt_id,'authority_digest',v_row.authority_digest,
    'boot_id',v_row.boot_id,'capability_digest',v_row.capability_digest,'claim_id',v_row.claim_id,'effect_domain',v_row.effect_domain,
    'expires_at',v_row.expires_at,'fencing_token',v_row.fencing_token,'holder_instance_id',v_row.holder_instance_id,
    'holder_worker_id',v_row.holder_worker_id,'input_digest',v_row.input_digest,'job_id',v_row.job_id,'lease_id',v_row.lease_id,'run_id',v_row.run_id));
  v_row.descriptor_digest:=v_digest;
  INSERT INTO ai_evalops.settlement_descriptors SELECT v_row.*
    ON CONFLICT (descriptor_id) DO NOTHING RETURNING * INTO v_row;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM ai_evalops.settlement_descriptors WHERE descriptor_id=p_descriptor_id;
    IF v_row.descriptor_digest<>v_digest THEN RAISE EXCEPTION 'SETTLEMENT_DESCRIPTOR_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
  END IF;
  RETURN v_row;
END; $$;

CREATE FUNCTION ai_evalops.reconstruct_settlement_descriptor(p_descriptor_id uuid,p_descriptor_digest text)
RETURNS ai_evalops.settlement_descriptors LANGUAGE plpgsql AS $$
DECLARE v_row ai_evalops.settlement_descriptors%ROWTYPE;
BEGIN
  SELECT d.* INTO v_row FROM ai_evalops.settlement_descriptors d
    JOIN ai_evalops.leases l ON l.lease_id=d.lease_id AND l.attempt_id=d.attempt_id AND l.fencing_token=d.fencing_token
    JOIN ai_evalops.authority_status s ON s.authority_digest=d.authority_digest
    JOIN ai_evalops.worker_capability_status c ON c.worker_id=d.holder_worker_id AND c.instance_id=d.holder_instance_id AND c.boot_id=d.boot_id AND c.capability_digest=d.capability_digest
    WHERE d.descriptor_id=p_descriptor_id AND d.descriptor_digest=p_descriptor_digest AND d.expires_at>clock_timestamp()
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND s.status='ACTIVE' AND s.revoked_at IS NULL AND s.valid_until>clock_timestamp()
      AND c.status='FRESH' AND c.valid_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_DESCRIPTOR_NOT_CURRENT' USING ERRCODE='55000'; END IF;
  RETURN v_row;
END; $$;

CREATE FUNCTION ai_evalops.settle_descriptor(p_operation_id uuid,p_descriptor_id uuid,p_descriptor_digest text,p_outcome text,p_evidence_id uuid)
RETURNS ai_evalops.settlement_receipts LANGUAGE plpgsql AS $$
DECLARE v_descriptor ai_evalops.settlement_descriptors%ROWTYPE; v_receipt ai_evalops.settlement_receipts%ROWTYPE; v_request text;
BEGIN
  v_request:=ai_evalops.canonical_operation_digest(jsonb_build_object('descriptor_digest',p_descriptor_digest,'descriptor_id',p_descriptor_id,'evidence_id',p_evidence_id,'outcome',p_outcome));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.settlement_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.request_digest<>v_request THEN RAISE EXCEPTION 'SETTLEMENT_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN v_receipt;
  END IF;
  v_descriptor:=ai_evalops.reconstruct_settlement_descriptor(p_descriptor_id,p_descriptor_digest);
  IF p_outcome NOT IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED') THEN RAISE EXCEPTION 'SETTLEMENT_OUTCOME_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO ai_evalops.settlement_receipts(operation_id,descriptor_id,descriptor_digest,outcome,evidence_id,request_digest)
    VALUES(p_operation_id,p_descriptor_id,p_descriptor_digest,p_outcome,p_evidence_id,v_request) RETURNING * INTO v_receipt;
  UPDATE ai_evalops.job_projection SET state='TERMINAL',terminal_classification=p_outcome,
    terminal_receipt_evidence_id=p_evidence_id,terminal_receipt_evidence_type='TERMINAL_RECEIPT',version=version+1,updated_at=clock_timestamp()
    WHERE job_id=v_descriptor.job_id AND current_attempt_id=v_descriptor.attempt_id AND state IN ('CLAIMED','RUNNING','RECONCILING');
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_PROJECTION_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN v_receipt;
END; $$;
