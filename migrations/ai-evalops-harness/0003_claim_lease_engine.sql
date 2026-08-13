-- WO-AEH-016 replay-safe atomic claim/lease/fence protocol. Database time is authoritative.
CREATE TABLE ai_evalops.lease_operation_receipts (
  operation_id uuid PRIMARY KEY,
  operation_kind text NOT NULL CHECK (operation_kind IN ('CLAIM','PULL','RENEW','RELEASE','EXPIRE','RECONCILE')),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER lease_operation_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.lease_operation_receipts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE TABLE ai_evalops.authority_status (
  authority_digest text PRIMARY KEY CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED','EXPIRED')),
  valid_until timestamptz NOT NULL,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  CHECK ((status='REVOKED')=(revoked_at IS NOT NULL))
);

CREATE TABLE ai_evalops.worker_capability_status (
  worker_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('FRESH','STALE','REVOKED')),
  observed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  PRIMARY KEY(worker_id,instance_id,boot_id,capability_digest),
  FOREIGN KEY(worker_id,instance_id,boot_id) REFERENCES ai_evalops.workers(worker_id,instance_id,boot_id),
  CHECK(valid_until > observed_at)
);

CREATE FUNCTION ai_evalops.canonical_operation_digest(p_semantics jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(p_semantics::text,'UTF8')),'hex')
$$;

CREATE FUNCTION ai_evalops.claim_job(
  p_job_id uuid, p_worker_id uuid, p_worker_instance_id uuid, p_boot_id uuid,
  p_claim_id uuid, p_lease_id uuid, p_operation_id uuid, p_ttl interval
) RETURNS TABLE(attempt_id uuid, lease_id uuid, fencing_token bigint, expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_job ai_evalops.jobs%ROWTYPE; v_projection ai_evalops.job_projection%ROWTYPE;
DECLARE v_worker ai_evalops.workers%ROWTYPE; v_receipt ai_evalops.lease_operation_receipts%ROWTYPE;
DECLARE v_attempt_id uuid; v_ordinal integer; v_fence bigint; v_expiry timestamptz;
DECLARE v_request_digest text;
DECLARE v_event_sequence bigint; v_prior_event_digest text;
BEGIN
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('boot_id',p_boot_id,'claim_id',p_claim_id,'job_id',p_job_id,'lease_id',p_lease_id,'ttl_seconds',extract(epoch from p_ttl),'worker_id',p_worker_id,'worker_instance_id',p_worker_instance_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.operation_kind<>'CLAIM' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN QUERY SELECT (v_receipt.response->>'attempt_id')::uuid,(v_receipt.response->>'lease_id')::uuid,(v_receipt.response->>'fencing_token')::bigint,(v_receipt.response->>'expires_at')::timestamptz; RETURN;
  END IF;
  IF p_ttl<interval '5 seconds' OR p_ttl>interval '1 hour' THEN RAISE EXCEPTION 'CLAIM_TTL_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_job FROM ai_evalops.jobs WHERE job_id=p_job_id FOR UPDATE;
  SELECT * INTO v_projection FROM ai_evalops.job_projection WHERE job_id=p_job_id FOR UPDATE;
  IF v_job.job_id IS NULL OR v_job.admission_expires_at<=clock_timestamp() OR v_projection.state<>'ADMITTED' THEN RAISE EXCEPTION 'CLAIM_NOT_ELIGIBLE' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_worker FROM ai_evalops.workers WHERE worker_id=p_worker_id AND instance_id=p_worker_instance_id AND boot_id=p_boot_id AND retired_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_WORKER_IDENTITY_INVALID' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_evalops.authority_status s WHERE s.authority_digest=v_job.authority_digest AND s.status='ACTIVE' AND s.revoked_at IS NULL AND s.valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_evalops.worker_capability_status c WHERE c.worker_id=p_worker_id AND c.instance_id=p_worker_instance_id AND c.boot_id=p_boot_id AND c.capability_digest=v_worker.capability_digest AND c.status='FRESH' AND c.valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'CAPABILITY_NOT_FRESH' USING ERRCODE='55000'; END IF;
  SELECT next_fencing_token INTO v_fence FROM ai_evalops.effect_domain_fences WHERE effect_domain=v_job.effect_domain FOR UPDATE;
  SELECT COALESCE(max(ordinal),0)+1 INTO v_ordinal FROM ai_evalops.attempts WHERE job_id=p_job_id;
  v_attempt_id:=gen_random_uuid(); v_expiry:=clock_timestamp()+p_ttl;
  INSERT INTO ai_evalops.attempts(attempt_id,job_id,effect_domain,ordinal,worker_id,worker_instance_id,boot_id,claim_id,input_digest)
    VALUES(v_attempt_id,p_job_id,v_job.effect_domain,v_ordinal,p_worker_id,p_worker_instance_id,p_boot_id,p_claim_id,v_job.input_digest);
  INSERT INTO ai_evalops.leases(lease_id,attempt_id,effect_domain,holder_worker_id,holder_instance_id,boot_id,fencing_token,expires_at)
    VALUES(p_lease_id,v_attempt_id,v_job.effect_domain,p_worker_id,p_worker_instance_id,p_boot_id,v_fence,v_expiry);
  UPDATE ai_evalops.job_projection SET state='CLAIMED',current_attempt_id=v_attempt_id,version=version+1,updated_at=clock_timestamp()
    WHERE job_id=p_job_id AND version=v_projection.version AND state='ADMITTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECTION_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO v_event_sequence FROM ai_evalops.events WHERE job_id=p_job_id;
  SELECT event_digest INTO v_prior_event_digest FROM ai_evalops.events WHERE job_id=p_job_id AND sequence=v_event_sequence-1;
  INSERT INTO ai_evalops.events(event_id,job_id,attempt_id,sequence,event_type,actor_id,authority_digest,input_digest,prior_event_digest,event_digest)
    VALUES(gen_random_uuid(),p_job_id,v_attempt_id,v_event_sequence,'CLAIMED',p_worker_id::text,v_job.authority_digest,v_job.input_digest,v_prior_event_digest,
      ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',v_attempt_id,'event','CLAIMED','fence',v_fence,'job_id',p_job_id)));
  INSERT INTO ai_evalops.lease_operation_receipts VALUES(p_operation_id,'CLAIM',v_request_digest,jsonb_build_object('attempt_id',v_attempt_id,'lease_id',p_lease_id,'fencing_token',v_fence,'expires_at',v_expiry),clock_timestamp());
  RETURN QUERY SELECT v_attempt_id,p_lease_id,v_fence,v_expiry;
EXCEPTION WHEN unique_violation THEN
  IF SQLERRM LIKE '%lease_operation_receipts%' THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RAISE EXCEPTION 'CLAIM_NOT_ELIGIBLE' USING ERRCODE='55000';
END;
$$;

CREATE FUNCTION ai_evalops.pull_next_job(
  p_worker_id uuid,p_worker_instance_id uuid,p_boot_id uuid,p_claim_id uuid,p_lease_id uuid,
  p_operation_id uuid,p_ttl interval
) RETURNS TABLE(attempt_id uuid,lease_id uuid,fencing_token bigint,expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_job_id uuid;
DECLARE v_receipt ai_evalops.lease_operation_receipts%ROWTYPE; v_request_digest text; v_child_operation uuid; v_claim record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('boot_id',p_boot_id,'claim_id',p_claim_id,'job_id',(v_receipt.response->>'job_id')::uuid,'lease_id',p_lease_id,'ttl_seconds',extract(epoch from p_ttl),'worker_id',p_worker_id,'worker_instance_id',p_worker_instance_id));
    IF v_receipt.operation_kind<>'PULL' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN QUERY SELECT (v_receipt.response->>'attempt_id')::uuid,(v_receipt.response->>'lease_id')::uuid,(v_receipt.response->>'fencing_token')::bigint,(v_receipt.response->>'expires_at')::timestamptz; RETURN;
  END IF;
  SELECT j.job_id INTO v_job_id FROM ai_evalops.jobs j JOIN ai_evalops.job_projection p USING(job_id)
    WHERE p.state='ADMITTED' AND j.admission_expires_at>clock_timestamp()
      AND NOT EXISTS(SELECT 1 FROM ai_evalops.leases l WHERE l.effect_domain=j.effect_domain AND l.released_at IS NULL)
    ORDER BY j.priority DESC,j.created_at,j.job_id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF v_job_id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_ELIGIBLE' USING ERRCODE='55000'; END IF;
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('boot_id',p_boot_id,'claim_id',p_claim_id,'job_id',v_job_id,'lease_id',p_lease_id,'ttl_seconds',extract(epoch from p_ttl),'worker_id',p_worker_id,'worker_instance_id',p_worker_instance_id));
  v_child_operation := (substr(md5(p_operation_id::text||':claim'),1,8)||'-'||substr(md5(p_operation_id::text||':claim'),9,4)||'-4'||substr(md5(p_operation_id::text||':claim'),14,3)||'-8'||substr(md5(p_operation_id::text||':claim'),18,3)||'-'||substr(md5(p_operation_id::text||':claim'),21,12))::uuid;
  SELECT * INTO v_claim FROM ai_evalops.claim_job(v_job_id,p_worker_id,p_worker_instance_id,p_boot_id,p_claim_id,p_lease_id,v_child_operation,p_ttl);
  INSERT INTO ai_evalops.lease_operation_receipts VALUES(p_operation_id,'PULL',v_request_digest,
    jsonb_build_object('job_id',v_job_id,'attempt_id',v_claim.attempt_id,'lease_id',v_claim.lease_id,'fencing_token',v_claim.fencing_token,'expires_at',v_claim.expires_at),clock_timestamp());
  RETURN QUERY SELECT v_claim.attempt_id,v_claim.lease_id,v_claim.fencing_token,v_claim.expires_at;
END;
$$;

CREATE FUNCTION ai_evalops.renew_lease(
  p_lease_id uuid,p_attempt_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,p_expected_sequence bigint,
  p_operation_id uuid,p_ttl interval
) RETURNS TABLE(renewal_sequence bigint,expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_receipt ai_evalops.lease_operation_receipts%ROWTYPE; v_new_expiry timestamptz; v_request_digest text;
BEGIN
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',p_attempt_id,'boot_id',p_boot_id,'expected_sequence',p_expected_sequence,'fence',p_fence,'instance_id',p_instance_id,'lease_id',p_lease_id,'ttl_seconds',extract(epoch from p_ttl),'worker_id',p_worker_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.operation_kind<>'RENEW' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN QUERY SELECT (v_receipt.response->>'renewal_sequence')::bigint,(v_receipt.response->>'expires_at')::timestamptz; RETURN;
  END IF;
  IF p_ttl<interval '5 seconds' OR p_ttl>interval '1 hour' THEN RAISE EXCEPTION 'CLAIM_TTL_INVALID' USING ERRCODE='22023'; END IF;
  v_new_expiry:=clock_timestamp()+p_ttl;
  RETURN QUERY UPDATE ai_evalops.leases l SET renewal_sequence=l.renewal_sequence+1,expires_at=v_new_expiry
    WHERE l.lease_id=p_lease_id AND l.attempt_id=p_attempt_id AND l.holder_worker_id=p_worker_id AND l.holder_instance_id=p_instance_id
      AND l.boot_id=p_boot_id AND l.fencing_token=p_fence AND l.renewal_sequence=p_expected_sequence AND l.released_at IS NULL
      AND l.expires_at>clock_timestamp() AND v_new_expiry>l.expires_at RETURNING l.renewal_sequence,l.expires_at;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.released_at IS NOT NULL) THEN RAISE EXCEPTION 'LEASE_ALREADY_RELEASED' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.boot_id<>p_boot_id) THEN RAISE EXCEPTION 'LEASE_WRONG_BOOT' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND (x.holder_worker_id<>p_worker_id OR x.holder_instance_id<>p_instance_id)) THEN RAISE EXCEPTION 'LEASE_WRONG_HOLDER' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.attempt_id=p_attempt_id
      AND x.holder_worker_id=p_worker_id AND x.holder_instance_id=p_instance_id AND x.boot_id=p_boot_id
      AND x.fencing_token=p_fence AND x.renewal_sequence=p_expected_sequence) THEN RAISE EXCEPTION 'LEASE_RENEWAL_TOO_EARLY' USING ERRCODE='55000'; END IF;
    RAISE EXCEPTION 'LEASE_STALE_OR_FORGED' USING ERRCODE='55000';
  END IF;
  INSERT INTO ai_evalops.lease_operation_receipts SELECT p_operation_id,'RENEW',v_request_digest,jsonb_build_object('renewal_sequence',l.renewal_sequence,'expires_at',l.expires_at),clock_timestamp() FROM ai_evalops.leases l WHERE lease_id=p_lease_id;
END;
$$;

CREATE FUNCTION ai_evalops.release_lease(
  p_lease_id uuid,p_attempt_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,p_expected_sequence bigint,
  p_operation_id uuid,p_reason text
) RETURNS TABLE(released_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE v_receipt ai_evalops.lease_operation_receipts%ROWTYPE; v_request_digest text;
BEGIN
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',p_attempt_id,'boot_id',p_boot_id,'expected_sequence',p_expected_sequence,'fence',p_fence,'instance_id',p_instance_id,'lease_id',p_lease_id,'reason',p_reason,'worker_id',p_worker_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.operation_kind<>'RELEASE' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN QUERY SELECT (v_receipt.response->>'released_at')::timestamptz; RETURN;
  END IF;
  IF p_reason!~'^[A-Z][A-Z0-9_]{1,63}$' THEN RAISE EXCEPTION 'LEASE_STALE_OR_FORGED' USING ERRCODE='22023'; END IF;
  RETURN QUERY UPDATE ai_evalops.leases l SET released_at=clock_timestamp(),release_reason=p_reason
    WHERE l.lease_id=p_lease_id AND l.attempt_id=p_attempt_id AND l.holder_worker_id=p_worker_id AND l.holder_instance_id=p_instance_id
      AND l.boot_id=p_boot_id AND l.fencing_token=p_fence AND l.renewal_sequence=p_expected_sequence AND l.released_at IS NULL AND l.expires_at>clock_timestamp()
    RETURNING l.released_at;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.released_at IS NOT NULL) THEN RAISE EXCEPTION 'LEASE_ALREADY_RELEASED' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'LEASE_EXPIRED' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND x.boot_id<>p_boot_id) THEN RAISE EXCEPTION 'LEASE_WRONG_BOOT' USING ERRCODE='55000'; END IF;
    IF EXISTS(SELECT 1 FROM ai_evalops.leases x WHERE x.lease_id=p_lease_id AND (x.holder_worker_id<>p_worker_id OR x.holder_instance_id<>p_instance_id)) THEN RAISE EXCEPTION 'LEASE_WRONG_HOLDER' USING ERRCODE='55000'; END IF;
    RAISE EXCEPTION 'LEASE_STALE_OR_FORGED' USING ERRCODE='55000';
  END IF;
  INSERT INTO ai_evalops.lease_operation_receipts SELECT p_operation_id,'RELEASE',v_request_digest,jsonb_build_object('released_at',l.released_at),clock_timestamp() FROM ai_evalops.leases l WHERE lease_id=p_lease_id;
END;
$$;

CREATE FUNCTION ai_evalops.expire_lease(p_lease_id uuid,p_operation_id uuid)
RETURNS TABLE(job_id uuid,expired_attempt_id uuid) LANGUAGE plpgsql AS $$
DECLARE v_receipt ai_evalops.lease_operation_receipts%ROWTYPE; v_job_id uuid; v_attempt uuid; v_request_digest text;
DECLARE v_authority text; v_event_sequence bigint; v_prior_event_digest text;
BEGIN
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('lease_id',p_lease_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_receipt.operation_kind<>'EXPIRE' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN QUERY SELECT (v_receipt.response->>'job_id')::uuid,(v_receipt.response->>'attempt_id')::uuid; RETURN;
  END IF;
  SELECT a.job_id,l.attempt_id INTO v_job_id,v_attempt FROM ai_evalops.leases l JOIN ai_evalops.attempts a USING(attempt_id)
    WHERE l.lease_id=p_lease_id AND l.released_at IS NULL AND l.expires_at<=clock_timestamp() FOR UPDATE OF l;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_EXPIRED' USING ERRCODE='55000'; END IF;
  UPDATE ai_evalops.leases SET released_at=clock_timestamp(),release_reason='EXPIRED' WHERE lease_id=p_lease_id;
  UPDATE ai_evalops.job_projection p SET state='RECONCILING',version=p.version+1,updated_at=clock_timestamp()
    WHERE p.job_id=v_job_id AND p.current_attempt_id=v_attempt AND p.state IN ('CLAIMED','RUNNING','RECONCILING');
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECTION_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
  SELECT j.authority_digest INTO v_authority FROM ai_evalops.jobs j WHERE j.job_id=v_job_id;
  SELECT COALESCE(max(e.sequence),0)+1 INTO v_event_sequence FROM ai_evalops.events e WHERE e.job_id=v_job_id;
  SELECT e.event_digest INTO v_prior_event_digest FROM ai_evalops.events e WHERE e.job_id=v_job_id AND e.sequence=v_event_sequence-1;
  INSERT INTO ai_evalops.events(event_id,job_id,attempt_id,sequence,event_type,actor_id,authority_digest,prior_event_digest,event_digest)
    VALUES(gen_random_uuid(),v_job_id,v_attempt,v_event_sequence,'LEASE_EXPIRED','DATABASE',v_authority,v_prior_event_digest,
      ai_evalops.canonical_operation_digest(jsonb_build_object('attempt_id',v_attempt,'event','LEASE_EXPIRED','job_id',v_job_id)));
  INSERT INTO ai_evalops.lease_operation_receipts VALUES(p_operation_id,'EXPIRE',v_request_digest,jsonb_build_object('job_id',v_job_id,'attempt_id',v_attempt),clock_timestamp());
  RETURN QUERY SELECT v_job_id,v_attempt;
END;
$$;

CREATE FUNCTION ai_evalops.validate_current_fence(
  p_lease_id uuid,p_attempt_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,
  p_authority_digest text,p_capability_digest text
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM ai_evalops.leases l JOIN ai_evalops.attempts a USING(attempt_id)
      JOIN ai_evalops.jobs j ON j.job_id=a.job_id JOIN ai_evalops.workers w ON w.worker_id=l.holder_worker_id
      JOIN ai_evalops.effect_domain_fences f ON f.effect_domain=l.effect_domain
      JOIN ai_evalops.authority_status s ON s.authority_digest=j.authority_digest
      JOIN ai_evalops.worker_capability_status c ON c.worker_id=w.worker_id AND c.instance_id=w.instance_id AND c.boot_id=w.boot_id AND c.capability_digest=w.capability_digest
    WHERE l.lease_id=p_lease_id AND l.attempt_id=p_attempt_id AND l.holder_worker_id=p_worker_id
      AND l.holder_instance_id=p_instance_id AND l.boot_id=p_boot_id AND l.fencing_token=p_fence
      AND l.released_at IS NULL AND l.expires_at>clock_timestamp() AND f.next_fencing_token=p_fence+1
      AND j.authority_digest=p_authority_digest AND s.status='ACTIVE' AND s.revoked_at IS NULL AND s.valid_until>clock_timestamp()
      AND w.instance_id=p_instance_id AND w.boot_id=p_boot_id AND w.retired_at IS NULL AND w.capability_digest=p_capability_digest
      AND c.status='FRESH' AND c.valid_until>clock_timestamp()
  ) THEN RAISE EXCEPTION 'FENCE_NOT_CURRENT' USING ERRCODE='55000'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION ai_evalops.reconcile_expiry(
  p_job_id uuid,p_attempt_id uuid,p_operation_id uuid,p_actor_id text,p_authority_digest text,
  p_evidence_id uuid,p_evidence_digest text,p_adapter_result text,p_expected_version bigint
)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_receipt ai_evalops.lease_operation_receipts%ROWTYPE; v_request_digest text; v_projection ai_evalops.job_projection%ROWTYPE;
DECLARE v_event_sequence bigint; v_prior_event_digest text; v_result text;
BEGIN
  v_request_digest:=ai_evalops.canonical_operation_digest(jsonb_build_object('actor_id',p_actor_id,'adapter_result',p_adapter_result,'attempt_id',p_attempt_id,'authority_digest',p_authority_digest,'evidence_digest',p_evidence_digest,'evidence_id',p_evidence_id,'expected_version',p_expected_version,'job_id',p_job_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  SELECT * INTO v_receipt FROM ai_evalops.lease_operation_receipts WHERE operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.operation_kind<>'RECONCILE' OR v_receipt.request_digest<>v_request_digest THEN RAISE EXCEPTION 'OPERATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002'; END IF;
    RETURN v_receipt.response->>'result';
  END IF;
  IF p_actor_id!~'^[A-Za-z0-9:_-]{3,128}$' OR p_adapter_result NOT IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS') THEN RAISE EXCEPTION 'RECONCILIATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_evalops.jobs j JOIN ai_evalops.authority_status s ON s.authority_digest=j.authority_digest WHERE j.job_id=p_job_id AND j.authority_digest=p_authority_digest AND s.status='ACTIVE' AND s.revoked_at IS NULL AND s.valid_until>clock_timestamp()) THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ai_evalops.evidence_references e WHERE e.evidence_id=p_evidence_id AND e.evidence_type='RECOVERY_OBSERVATION' AND e.content_digest=p_evidence_digest) THEN RAISE EXCEPTION 'RECONCILIATION_EVIDENCE_INVALID' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_projection FROM ai_evalops.job_projection WHERE job_id=p_job_id FOR UPDATE;
  IF NOT FOUND OR v_projection.state<>'RECONCILING' OR v_projection.current_attempt_id<>p_attempt_id OR v_projection.version<>p_expected_version THEN RAISE EXCEPTION 'PROJECTION_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_adapter_result='NOT_EXECUTED' THEN
    UPDATE ai_evalops.job_projection SET state='ADMITTED',current_attempt_id=NULL,version=version+1,updated_at=clock_timestamp() WHERE job_id=p_job_id AND version=p_expected_version;
    v_result:='RETRY_SAFE';
  ELSIF p_adapter_result='EXECUTED' THEN v_result:='NON_RETRY_EXECUTED';
  ELSE v_result:='AMBIGUOUS_RECONCILIATION_REQUIRED'; END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO v_event_sequence FROM ai_evalops.events WHERE job_id=p_job_id;
  SELECT event_digest INTO v_prior_event_digest FROM ai_evalops.events WHERE job_id=p_job_id AND sequence=v_event_sequence-1;
  INSERT INTO ai_evalops.events(event_id,job_id,attempt_id,sequence,event_type,actor_id,authority_digest,output_digest,prior_event_digest,event_digest,evidence_id)
    VALUES(gen_random_uuid(),p_job_id,p_attempt_id,v_event_sequence,'EXPIRY_RECONCILED',p_actor_id,p_authority_digest,p_evidence_digest,v_prior_event_digest,
      ai_evalops.canonical_operation_digest(jsonb_build_object('adapter_result',p_adapter_result,'attempt_id',p_attempt_id,'evidence_id',p_evidence_id,'event','EXPIRY_RECONCILED','job_id',p_job_id,'operation_id',p_operation_id)),p_evidence_id);
  INSERT INTO ai_evalops.lease_operation_receipts VALUES(p_operation_id,'RECONCILE',v_request_digest,jsonb_build_object('result',v_result),clock_timestamp());
  RETURN v_result;
END;
$$;
