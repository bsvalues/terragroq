-- WO-AEH-021 durable coordinator cancellation. Disposable validation only.
CREATE TABLE ai_evalops.worker_envelope_receipts(
 message_id uuid PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,message_kind text NOT NULL CHECK(message_kind IN('PULL','HEARTBEAT','CANCEL','CANCEL_ACK')),
 envelope_digest text NOT NULL CHECK(envelope_digest~'^sha256:[a-f0-9]{64}$'),key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9._:-]{1,128}$'),authority_digest text NOT NULL CHECK(authority_digest~'^sha256:[a-f0-9]{64}$'),worker_id uuid NOT NULL,instance_id uuid NOT NULL,boot_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(worker_id,instance_id,boot_id) REFERENCES ai_evalops.workers(worker_id,instance_id,boot_id));
CREATE TRIGGER worker_envelope_receipts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.worker_envelope_receipts FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();
CREATE FUNCTION ai_evalops.consume_worker_envelope(p_message_id uuid,p_operation_id uuid,p_kind text,p_digest text,p_key_id text,p_authority_digest text,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_expires_at timestamptz)
RETURNS ai_evalops.worker_envelope_receipts LANGUAGE plpgsql AS $$ DECLARE r ai_evalops.worker_envelope_receipts%ROWTYPE;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_message_id::text,0));SELECT * INTO r FROM ai_evalops.worker_envelope_receipts WHERE message_id=p_message_id;
 IF FOUND THEN IF r.operation_id<>p_operation_id OR r.message_kind<>p_kind OR r.envelope_digest<>p_digest OR r.key_id<>p_key_id OR r.authority_digest<>p_authority_digest THEN RAISE EXCEPTION 'WORKER_ENVELOPE_REPLAY_CONFLICT' USING ERRCODE='P0002';END IF;RETURN r;END IF;
 IF p_expires_at<=clock_timestamp() OR p_kind NOT IN('PULL','HEARTBEAT','CANCEL','CANCEL_ACK') THEN RAISE EXCEPTION 'WORKER_ENVELOPE_EXPIRED' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.worker_capability_status WHERE worker_id=p_worker_id AND instance_id=p_instance_id AND boot_id=p_boot_id AND status='FRESH' AND valid_until>clock_timestamp() FOR UPDATE) THEN RAISE EXCEPTION 'CAPABILITY_NOT_FRESH' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.authority_status WHERE authority_digest=p_authority_digest AND status='ACTIVE' AND revoked_at IS NULL AND valid_until>clock_timestamp() FOR UPDATE) THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000';END IF;
 INSERT INTO ai_evalops.worker_envelope_receipts VALUES(p_message_id,p_operation_id,p_kind,p_digest,p_key_id,p_authority_digest,p_worker_id,p_instance_id,p_boot_id,p_expires_at,clock_timestamp()) RETURNING * INTO r;RETURN r;END $$;

CREATE FUNCTION ai_evalops.worker_heartbeat(p_message_id uuid,p_envelope_digest text,p_key_id text,p_effect_domain text,p_lease_id uuid,p_attempt_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,p_expected_sequence bigint,p_operation_id uuid,p_ttl interval,p_authority_digest text,p_capability_digest text,p_envelope_expires_at timestamptz)
RETURNS TABLE(renewal_sequence bigint,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ai_evalops,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||p_effect_domain,0));
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.leases WHERE lease_id=p_lease_id AND attempt_id=p_attempt_id AND effect_domain=p_effect_domain AND fencing_token=p_fence) THEN RAISE EXCEPTION 'WORKER_EFFECT_DOMAIN_MISMATCH' USING ERRCODE='55000';END IF;
 PERFORM ai_evalops.consume_worker_envelope(p_message_id,p_operation_id,'HEARTBEAT',p_envelope_digest,p_key_id,p_authority_digest,p_worker_id,p_instance_id,p_boot_id,p_envelope_expires_at);
 PERFORM ai_evalops.validate_current_fence(p_lease_id,p_attempt_id,p_worker_id,p_instance_id,p_boot_id,p_fence,p_authority_digest,p_capability_digest);
 RETURN QUERY SELECT * FROM ai_evalops.renew_lease(p_lease_id,p_attempt_id,p_worker_id,p_instance_id,p_boot_id,p_fence,p_expected_sequence,p_operation_id,p_ttl);
END $$;

CREATE FUNCTION ai_evalops.pull_worker_envelope(p_message_id uuid,p_envelope_digest text,p_key_id text,p_effect_domain text,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_claim_id uuid,p_lease_id uuid,p_operation_id uuid,p_ttl interval,p_authority_digest text,p_envelope_expires_at timestamptz)
RETURNS TABLE(attempt_id uuid,lease_id uuid,fencing_token bigint,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ai_evalops,pg_temp AS $$ DECLARE x record;v_job uuid;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||p_effect_domain,0));
 SELECT a.job_id INTO v_job
 FROM ai_evalops.lease_operation_receipts r
 JOIN ai_evalops.attempts a ON a.attempt_id=(r.response->>'attempt_id')::uuid
 WHERE r.operation_id=p_operation_id AND r.operation_kind='CLAIM';
 IF NOT FOUND THEN SELECT j.job_id INTO v_job FROM ai_evalops.jobs j JOIN ai_evalops.job_projection p USING(job_id) WHERE j.effect_domain=p_effect_domain AND j.authority_digest=p_authority_digest AND p.state='ADMITTED' AND j.admission_expires_at>clock_timestamp() ORDER BY j.priority DESC,j.created_at,j.job_id LIMIT 1;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLAIM_NOT_ELIGIBLE' USING ERRCODE='55000';END IF;
 PERFORM ai_evalops.consume_worker_envelope(p_message_id,p_operation_id,'PULL',p_envelope_digest,p_key_id,p_authority_digest,p_worker_id,p_instance_id,p_boot_id,p_envelope_expires_at);
 SELECT * INTO x FROM ai_evalops.claim_job(v_job,p_worker_id,p_instance_id,p_boot_id,p_claim_id,p_lease_id,p_operation_id,p_ttl);
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.attempts a JOIN ai_evalops.jobs j USING(job_id) WHERE a.attempt_id=x.attempt_id AND j.authority_digest=p_authority_digest AND j.effect_domain=p_effect_domain) THEN RAISE EXCEPTION 'AUTHORITY_SCOPE_MISMATCH' USING ERRCODE='55000';END IF;
 RETURN QUERY SELECT x.attempt_id,x.lease_id,x.fencing_token,x.expires_at;END $$;

CREATE TABLE ai_evalops.cancellation_intents(
  cancellation_id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, job_id uuid NOT NULL,
  attempt_id uuid NOT NULL, effect_domain text NOT NULL, fencing_token bigint NOT NULL CHECK(fencing_token>0),
  expected_projection_version bigint NOT NULL CHECK(expected_projection_version>=0), reason text NOT NULL CHECK(reason~'^[A-Z][A-Z0-9_]{1,63}$'),
  actor_id text NOT NULL CHECK(actor_id~'^[A-Za-z0-9:_-]{3,128}$'), authority_digest text NOT NULL CHECK(authority_digest~'^sha256:[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'), requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL, event_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(job_id,attempt_id) REFERENCES ai_evalops.attempts(job_id,attempt_id),
  FOREIGN KEY(attempt_id,effect_domain,fencing_token) REFERENCES ai_evalops.leases(attempt_id,effect_domain,fencing_token),
  CHECK(expires_at>requested_at));
CREATE TRIGGER cancellation_intents_immutable BEFORE UPDATE OR DELETE ON ai_evalops.cancellation_intents
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE TABLE ai_evalops.cancellation_acknowledgements(
  acknowledgement_id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, cancellation_id uuid NOT NULL UNIQUE REFERENCES ai_evalops.cancellation_intents(cancellation_id),
  worker_id uuid NOT NULL, instance_id uuid NOT NULL, boot_id uuid NOT NULL, renewal_sequence bigint NOT NULL CHECK(renewal_sequence>=0),
  disposition text NOT NULL CHECK(disposition IN('STOPPED_BEFORE_EFFECT','STOPPED_AFTER_EFFECT_STARTED','STOP_STATUS_AMBIGUOUS')),
  observation_evidence_id uuid NOT NULL REFERENCES ai_evalops.evidence_references(evidence_id),
  observation_evidence_digest text NOT NULL CHECK(observation_evidence_digest~'^sha256:[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK(request_digest~'^sha256:[a-f0-9]{64}$'), acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),event_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(worker_id,instance_id,boot_id) REFERENCES ai_evalops.workers(worker_id,instance_id,boot_id));
CREATE TRIGGER cancellation_acknowledgements_immutable BEFORE UPDATE OR DELETE ON ai_evalops.cancellation_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

CREATE FUNCTION ai_evalops.request_worker_cancellation(p_cancellation_id uuid,p_operation_id uuid,p_job_id uuid,p_attempt_id uuid,p_fence bigint,p_expected_version bigint,p_reason text,p_actor_id text,p_authority_digest text,p_ttl interval)
RETURNS ai_evalops.cancellation_intents LANGUAGE plpgsql AS $$
DECLARE c ai_evalops.cancellation_intents%ROWTYPE;p ai_evalops.job_projection%ROWTYPE;d text;domain text;seq bigint;prior text;ev uuid:=gen_random_uuid();ed text;
BEGIN
 d:=ai_evalops.canonical_operation_digest(jsonb_build_object('actor_id',p_actor_id,'attempt_id',p_attempt_id,'authority_digest',p_authority_digest,'cancellation_id',p_cancellation_id,'fence',p_fence,'job_id',p_job_id,'reason',p_reason,'ttl_seconds',extract(epoch from p_ttl),'version',p_expected_version));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));SELECT * INTO c FROM ai_evalops.cancellation_intents WHERE operation_id=p_operation_id;
 IF FOUND THEN IF c.request_digest<>d THEN RAISE EXCEPTION 'CANCELLATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002';END IF;RETURN c;END IF;
 IF p_ttl<interval '5 seconds' OR p_ttl>interval '10 minutes' OR p_reason!~'^[A-Z][A-Z0-9_]{1,63}$' THEN RAISE EXCEPTION 'CANCELLATION_INPUT_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO p FROM ai_evalops.job_projection WHERE job_id=p_job_id FOR UPDATE;
 IF NOT FOUND OR p.current_attempt_id IS DISTINCT FROM p_attempt_id OR p.version<>p_expected_version OR p.state NOT IN('CLAIMED','RUNNING') THEN RAISE EXCEPTION 'CANCELLATION_PROJECTION_CONFLICT' USING ERRCODE='40001';END IF;
 SELECT effect_domain INTO domain FROM ai_evalops.attempts WHERE attempt_id=p_attempt_id AND job_id=p_job_id;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.jobs j JOIN ai_evalops.authority_status a ON a.authority_digest=j.authority_digest WHERE j.job_id=p_job_id AND j.authority_digest=p_authority_digest AND a.status='ACTIVE' AND a.revoked_at IS NULL AND a.valid_until>clock_timestamp() FOR UPDATE OF a) THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.leases WHERE attempt_id=p_attempt_id AND effect_domain=domain AND fencing_token=p_fence AND released_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE) THEN RAISE EXCEPTION 'CANCELLATION_FENCE_NOT_CURRENT' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM ai_evalops.jobs WHERE job_id=p_job_id FOR UPDATE;SELECT coalesce(max(sequence),0)+1 INTO seq FROM ai_evalops.events WHERE job_id=p_job_id;SELECT event_digest INTO prior FROM ai_evalops.events WHERE job_id=p_job_id AND sequence=seq-1;
 ed:=ai_evalops.canonical_operation_digest(jsonb_build_object('event','CANCELLATION_REQUESTED','request',d));
 INSERT INTO ai_evalops.events VALUES(ev,p_job_id,p_attempt_id,seq,'CANCELLATION_REQUESTED',p_actor_id,p_authority_digest,NULL,NULL,prior,ed,NULL,clock_timestamp());
 INSERT INTO ai_evalops.cancellation_intents VALUES(p_cancellation_id,p_operation_id,p_job_id,p_attempt_id,domain,p_fence,p_expected_version,p_reason,p_actor_id,p_authority_digest,d,clock_timestamp(),clock_timestamp()+p_ttl,ev) RETURNING * INTO c;RETURN c;
END $$;

CREATE FUNCTION ai_evalops.request_worker_cancellation_enveloped(p_message_id uuid,p_envelope_digest text,p_key_id text,p_effect_domain text,p_envelope_expires_at timestamptz,p_cancellation_id uuid,p_operation_id uuid,p_job_id uuid,p_attempt_id uuid,p_fence bigint,p_expected_version bigint,p_reason text,p_actor_id text,p_authority_digest text,p_ttl interval,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid)
RETURNS ai_evalops.cancellation_intents LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ai_evalops,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||p_effect_domain,0));
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.jobs j JOIN ai_evalops.attempts a USING(job_id) WHERE j.job_id=p_job_id AND a.attempt_id=p_attempt_id AND j.effect_domain=p_effect_domain) THEN RAISE EXCEPTION 'WORKER_EFFECT_DOMAIN_MISMATCH' USING ERRCODE='55000';END IF;
 PERFORM ai_evalops.consume_worker_envelope(p_message_id,p_operation_id,'CANCEL',p_envelope_digest,p_key_id,p_authority_digest,p_worker_id,p_instance_id,p_boot_id,p_envelope_expires_at);
 RETURN ai_evalops.request_worker_cancellation(p_cancellation_id,p_operation_id,p_job_id,p_attempt_id,p_fence,p_expected_version,p_reason,p_actor_id,p_authority_digest,p_ttl);END $$;

CREATE FUNCTION ai_evalops.acknowledge_worker_cancellation(p_acknowledgement_id uuid,p_operation_id uuid,p_cancellation_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,p_renewal_sequence bigint,p_disposition text,p_evidence_id uuid,p_evidence_digest text)
RETURNS ai_evalops.cancellation_acknowledgements LANGUAGE plpgsql AS $$
DECLARE a ai_evalops.cancellation_acknowledgements%ROWTYPE;c ai_evalops.cancellation_intents%ROWTYPE;l ai_evalops.leases%ROWTYPE;p ai_evalops.job_projection%ROWTYPE;d text;seq bigint;prior text;ev uuid:=gen_random_uuid();ed text;
BEGIN
 d:=ai_evalops.canonical_operation_digest(jsonb_build_object('acknowledgement_id',p_acknowledgement_id,'boot_id',p_boot_id,'cancellation_id',p_cancellation_id,'disposition',p_disposition,'evidence_digest',p_evidence_digest,'evidence_id',p_evidence_id,'fence',p_fence,'instance_id',p_instance_id,'renewal_sequence',p_renewal_sequence,'worker_id',p_worker_id));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));SELECT * INTO a FROM ai_evalops.cancellation_acknowledgements WHERE operation_id=p_operation_id;
 IF FOUND THEN IF a.request_digest<>d THEN RAISE EXCEPTION 'CANCELLATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='P0002';END IF;RETURN a;END IF;
 SELECT * INTO c FROM ai_evalops.cancellation_intents WHERE cancellation_id=p_cancellation_id FOR UPDATE;IF NOT FOUND OR c.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CANCELLATION_INTENT_INVALID' USING ERRCODE='55000';END IF;
 SELECT * INTO p FROM ai_evalops.job_projection WHERE job_id=c.job_id FOR UPDATE;
 IF NOT FOUND OR p.current_attempt_id IS DISTINCT FROM c.attempt_id OR p.version<>c.expected_projection_version OR p.state NOT IN('CLAIMED','RUNNING') THEN RAISE EXCEPTION 'CANCELLATION_PROJECTION_CONFLICT' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.authority_status WHERE authority_digest=c.authority_digest AND status='ACTIVE' AND revoked_at IS NULL AND valid_until>clock_timestamp() FOR UPDATE) THEN RAISE EXCEPTION 'AUTHORITY_NOT_CURRENT' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.worker_capability_status WHERE worker_id=p_worker_id AND instance_id=p_instance_id AND boot_id=p_boot_id AND status='FRESH' AND valid_until>clock_timestamp() FOR UPDATE) THEN RAISE EXCEPTION 'CAPABILITY_NOT_FRESH' USING ERRCODE='55000';END IF;
 SELECT * INTO l FROM ai_evalops.leases WHERE attempt_id=c.attempt_id AND fencing_token=p_fence FOR UPDATE;
 IF NOT FOUND OR l.holder_worker_id<>p_worker_id OR l.holder_instance_id<>p_instance_id OR l.boot_id<>p_boot_id OR l.renewal_sequence<>p_renewal_sequence OR l.released_at IS NOT NULL OR l.expires_at<=clock_timestamp() OR p_fence<>c.fencing_token THEN RAISE EXCEPTION 'CANCELLATION_WORKER_STALE' USING ERRCODE='55000';END IF;
 IF p_disposition NOT IN('STOPPED_BEFORE_EFFECT','STOPPED_AFTER_EFFECT_STARTED','STOP_STATUS_AMBIGUOUS') THEN RAISE EXCEPTION 'CANCELLATION_INPUT_INVALID' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.evidence_references WHERE evidence_id=p_evidence_id AND evidence_type='RECOVERY_OBSERVATION' AND content_digest=p_evidence_digest) THEN RAISE EXCEPTION 'CANCELLATION_EVIDENCE_INVALID' USING ERRCODE='55000';END IF;
 UPDATE ai_evalops.leases SET released_at=clock_timestamp(),release_reason='CANCEL_ACKNOWLEDGED' WHERE lease_id=l.lease_id;
 UPDATE ai_evalops.job_projection SET state='RECONCILING',version=version+1,updated_at=clock_timestamp() WHERE job_id=c.job_id AND current_attempt_id=c.attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CANCELLATION_PROJECTION_CONFLICT' USING ERRCODE='40001';END IF;
 PERFORM 1 FROM ai_evalops.jobs WHERE job_id=c.job_id FOR UPDATE;SELECT coalesce(max(sequence),0)+1 INTO seq FROM ai_evalops.events WHERE job_id=c.job_id;SELECT event_digest INTO prior FROM ai_evalops.events WHERE job_id=c.job_id AND sequence=seq-1;ed:=ai_evalops.canonical_operation_digest(jsonb_build_object('disposition',p_disposition,'event','CANCELLATION_ACKNOWLEDGED','observation',p_evidence_digest));
 INSERT INTO ai_evalops.events VALUES(ev,c.job_id,c.attempt_id,seq,'CANCELLATION_ACKNOWLEDGED',p_worker_id::text,c.authority_digest,NULL,NULL,prior,ed,p_evidence_id,clock_timestamp());
 INSERT INTO ai_evalops.cancellation_acknowledgements VALUES(p_acknowledgement_id,p_operation_id,p_cancellation_id,p_worker_id,p_instance_id,p_boot_id,p_renewal_sequence,p_disposition,p_evidence_id,p_evidence_digest,d,clock_timestamp(),ev) RETURNING * INTO a;RETURN a;
END $$;

CREATE FUNCTION ai_evalops.acknowledge_worker_cancellation_enveloped(p_message_id uuid,p_envelope_digest text,p_key_id text,p_effect_domain text,p_authority_digest text,p_envelope_expires_at timestamptz,p_acknowledgement_id uuid,p_operation_id uuid,p_cancellation_id uuid,p_worker_id uuid,p_instance_id uuid,p_boot_id uuid,p_fence bigint,p_renewal_sequence bigint,p_disposition text,p_evidence_id uuid,p_evidence_digest text)
RETURNS ai_evalops.cancellation_acknowledgements LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ai_evalops,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('effect:'||p_effect_domain,0));
 IF NOT EXISTS(SELECT 1 FROM ai_evalops.cancellation_intents WHERE cancellation_id=p_cancellation_id AND effect_domain=p_effect_domain) THEN RAISE EXCEPTION 'WORKER_EFFECT_DOMAIN_MISMATCH' USING ERRCODE='55000';END IF;
 PERFORM ai_evalops.consume_worker_envelope(p_message_id,p_operation_id,'CANCEL_ACK',p_envelope_digest,p_key_id,p_authority_digest,p_worker_id,p_instance_id,p_boot_id,p_envelope_expires_at);
 RETURN ai_evalops.acknowledge_worker_cancellation(p_acknowledgement_id,p_operation_id,p_cancellation_id,p_worker_id,p_instance_id,p_boot_id,p_fence,p_renewal_sequence,p_disposition,p_evidence_id,p_evidence_digest);END $$;
REVOKE ALL ON FUNCTION ai_evalops.request_worker_cancellation(uuid,uuid,uuid,uuid,bigint,bigint,text,text,text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_evalops.acknowledge_worker_cancellation(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_evalops.consume_worker_envelope(uuid,uuid,text,text,text,text,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
