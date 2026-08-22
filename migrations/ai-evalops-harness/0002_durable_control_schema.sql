-- WO-AEH-015 durable control schema. Repository/disposable validation only.
CREATE TABLE ai_evalops.effect_domain_fences (
  effect_domain text PRIMARY KEY CHECK (effect_domain ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),
  next_fencing_token bigint NOT NULL DEFAULT 1 CHECK (next_fencing_token > 0)
);

CREATE TABLE ai_evalops.jobs (
  job_id uuid PRIMARY KEY,
  work_order_id text NOT NULL CHECK (btrim(work_order_id) = work_order_id AND work_order_id <> ''),
  effect_domain text NOT NULL REFERENCES ai_evalops.effect_domain_fences(effect_domain),
  operation_class text NOT NULL CHECK (operation_class ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) = idempotency_key AND idempotency_key <> ''),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  base_digest text NOT NULL CHECK (base_digest ~ '^sha256:[a-f0-9]{64}$'),
  requested_output_digest text NOT NULL CHECK (requested_output_digest ~ '^sha256:[a-f0-9]{64}$'),
  admission_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (effect_domain, idempotency_key),
  UNIQUE (job_id, effect_domain),
  UNIQUE (job_id, effect_domain, idempotency_key),
  CHECK (admission_expires_at > created_at)
);

CREATE TABLE ai_evalops.job_projection (
  job_id uuid PRIMARY KEY REFERENCES ai_evalops.jobs(job_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('ADMITTED','CLAIMED','RUNNING','RECONCILING','TERMINAL')),
  current_attempt_id uuid,
  terminal_classification text CHECK (terminal_classification IN ('NOT_EXECUTED','EXECUTED','AMBIGUOUS','EXPIRED','FENCED')),
  terminal_receipt_evidence_id uuid,
  terminal_receipt_evidence_type text CHECK (terminal_receipt_evidence_type = 'TERMINAL_RECEIPT'),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'TERMINAL') = (terminal_classification IS NOT NULL)),
  CHECK ((terminal_classification IS NULL) = (terminal_receipt_evidence_id IS NULL)),
  CHECK ((terminal_receipt_evidence_id IS NULL) = (terminal_receipt_evidence_type IS NULL))
);

CREATE TABLE ai_evalops.workers (
  worker_id uuid PRIMARY KEY,
  node_id text NOT NULL,
  instance_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[a-f0-9]{64}$'),
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  UNIQUE (worker_id, instance_id, boot_id),
  CHECK (retired_at IS NULL OR retired_at >= registered_at)
);

CREATE TABLE ai_evalops.attempts (
  attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ai_evalops.jobs(job_id) ON DELETE RESTRICT,
  effect_domain text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  worker_id uuid NOT NULL,
  worker_instance_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  claim_id uuid NOT NULL UNIQUE,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, ordinal),
  UNIQUE (job_id, attempt_id),
  UNIQUE (attempt_id, effect_domain),
  FOREIGN KEY (job_id, effect_domain)
    REFERENCES ai_evalops.jobs(job_id, effect_domain) ON DELETE RESTRICT,
  FOREIGN KEY (worker_id, worker_instance_id, boot_id)
    REFERENCES ai_evalops.workers(worker_id, instance_id, boot_id) ON DELETE RESTRICT
);

ALTER TABLE ai_evalops.job_projection
  ADD CONSTRAINT job_projection_attempt_fk FOREIGN KEY (job_id, current_attempt_id)
  REFERENCES ai_evalops.attempts(job_id, attempt_id) ON DELETE RESTRICT;

CREATE TABLE ai_evalops.leases (
  lease_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES ai_evalops.attempts(attempt_id) ON DELETE RESTRICT,
  effect_domain text NOT NULL REFERENCES ai_evalops.effect_domain_fences(effect_domain),
  holder_worker_id uuid NOT NULL,
  holder_instance_id uuid NOT NULL,
  boot_id uuid NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  renewal_sequence bigint NOT NULL DEFAULT 0 CHECK (renewal_sequence >= 0),
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  UNIQUE (effect_domain, fencing_token),
  UNIQUE (attempt_id, effect_domain, fencing_token),
  FOREIGN KEY (attempt_id, effect_domain)
    REFERENCES ai_evalops.attempts(attempt_id, effect_domain) ON DELETE RESTRICT,
  FOREIGN KEY (holder_worker_id, holder_instance_id, boot_id)
    REFERENCES ai_evalops.workers(worker_id, instance_id, boot_id) ON DELETE RESTRICT,
  CHECK (expires_at > acquired_at),
  CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  CHECK (released_at IS NULL OR released_at >= acquired_at)
);

CREATE UNIQUE INDEX leases_one_active_per_effect_domain
  ON ai_evalops.leases(effect_domain) WHERE released_at IS NULL;

CREATE FUNCTION ai_evalops.allocate_monotonic_lease_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ai_evalops.effect_domain_fences
    SET next_fencing_token = next_fencing_token + 1
    WHERE effect_domain = NEW.effect_domain
      AND next_fencing_token = NEW.fencing_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or skipped fencing token for domain %', NEW.effect_domain USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leases_monotonic_fence BEFORE INSERT ON ai_evalops.leases
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.allocate_monotonic_lease_fence();

CREATE FUNCTION ai_evalops.enforce_lease_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lease_id <> NEW.lease_id OR OLD.attempt_id <> NEW.attempt_id OR OLD.effect_domain <> NEW.effect_domain
     OR OLD.holder_worker_id <> NEW.holder_worker_id OR OLD.holder_instance_id <> NEW.holder_instance_id
     OR OLD.boot_id <> NEW.boot_id OR OLD.fencing_token <> NEW.fencing_token
     OR OLD.acquired_at <> NEW.acquired_at THEN
    RAISE EXCEPTION 'immutable lease identity changed' USING ERRCODE = '55000';
  END IF;
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'released lease cannot be renewed or reopened' USING ERRCODE = '55000';
  END IF;
  IF NEW.released_at IS NULL THEN
    IF NEW.renewal_sequence <> OLD.renewal_sequence + 1 OR NEW.expires_at <= OLD.expires_at THEN
      RAISE EXCEPTION 'lease renewal must advance sequence and expiry' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.renewal_sequence <> OLD.renewal_sequence OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'lease release cannot rewrite renewal state' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leases_transition BEFORE UPDATE ON ai_evalops.leases
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.enforce_lease_transition();

CREATE TABLE ai_evalops.evidence_references (
  evidence_id uuid PRIMARY KEY,
  evidence_type text NOT NULL CHECK (evidence_type IN ('TERMINAL_RECEIPT','ATTEMPT_OUTPUT','EVENT_ATTACHMENT','RECOVERY_OBSERVATION')),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  durable_uri text NOT NULL CHECK (durable_uri ~ '^[a-z][a-z0-9+.-]*://'),
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (content_digest, durable_uri),
  UNIQUE (evidence_id, evidence_type)
);

ALTER TABLE ai_evalops.job_projection
  ADD CONSTRAINT job_projection_receipt_fk FOREIGN KEY (terminal_receipt_evidence_id, terminal_receipt_evidence_type)
  REFERENCES ai_evalops.evidence_references(evidence_id, evidence_type) ON DELETE RESTRICT;

CREATE TABLE ai_evalops.events (
  event_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ai_evalops.jobs(job_id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES ai_evalops.attempts(attempt_id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  actor_id text NOT NULL,
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_digest text CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  output_digest text CHECK (output_digest ~ '^sha256:[a-f0-9]{64}$'),
  prior_event_digest text CHECK (prior_event_digest ~ '^sha256:[a-f0-9]{64}$'),
  event_digest text NOT NULL UNIQUE CHECK (event_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_id uuid REFERENCES ai_evalops.evidence_references(evidence_id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, sequence),
  FOREIGN KEY (job_id, attempt_id)
    REFERENCES ai_evalops.attempts(job_id, attempt_id) ON DELETE RESTRICT
);

ALTER TABLE ai_evalops.events
  ADD CONSTRAINT events_prior_digest_fk FOREIGN KEY (prior_event_digest)
  REFERENCES ai_evalops.events(event_digest) ON DELETE RESTRICT;

CREATE FUNCTION ai_evalops.enforce_contiguous_event_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_prior text;
BEGIN
  PERFORM 1 FROM ai_evalops.jobs WHERE job_id = NEW.job_id FOR UPDATE;
  IF NEW.sequence = 1 THEN
    IF NEW.prior_event_digest IS NOT NULL OR EXISTS (SELECT 1 FROM ai_evalops.events WHERE job_id = NEW.job_id) THEN
      RAISE EXCEPTION 'first event must be sequence 1 with null prior digest' USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT event_digest INTO expected_prior FROM ai_evalops.events
      WHERE job_id = NEW.job_id AND sequence = NEW.sequence - 1;
    IF expected_prior IS NULL OR NEW.prior_event_digest IS DISTINCT FROM expected_prior THEN
      RAISE EXCEPTION 'event must bind immediate prior sequence digest' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_contiguous_chain BEFORE INSERT ON ai_evalops.events
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.enforce_contiguous_event_chain();

CREATE TABLE ai_evalops.outbox (
  outbox_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES ai_evalops.jobs(job_id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES ai_evalops.attempts(attempt_id) ON DELETE RESTRICT,
  effect_domain text NOT NULL,
  idempotency_key text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  receipt_evidence_id uuid REFERENCES ai_evalops.evidence_references(evidence_id) ON DELETE RESTRICT,
  UNIQUE (effect_domain, idempotency_key),
  FOREIGN KEY (job_id, attempt_id)
    REFERENCES ai_evalops.attempts(job_id, attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, effect_domain, fencing_token)
    REFERENCES ai_evalops.leases(attempt_id, effect_domain, fencing_token) ON DELETE RESTRICT,
  FOREIGN KEY (job_id, effect_domain, idempotency_key)
    REFERENCES ai_evalops.jobs(job_id, effect_domain, idempotency_key) ON DELETE RESTRICT,
  CHECK ((delivered_at IS NULL) OR (receipt_evidence_id IS NOT NULL))
);

CREATE FUNCTION ai_evalops.enforce_current_outbox_lease() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_evalops.leases
    WHERE attempt_id = NEW.attempt_id AND effect_domain = NEW.effect_domain
      AND fencing_token = NEW.fencing_token AND released_at IS NULL AND expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'outbox requires current allocated lease and fence' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_current_lease BEFORE INSERT ON ai_evalops.outbox
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.enforce_current_outbox_lease();

CREATE FUNCTION ai_evalops.reject_immutable_control_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable control ledger row: %', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER jobs_immutable BEFORE UPDATE OR DELETE ON ai_evalops.jobs
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();
CREATE TRIGGER attempts_immutable BEFORE UPDATE OR DELETE ON ai_evalops.attempts
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON ai_evalops.events
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();
CREATE TRIGGER evidence_references_immutable BEFORE UPDATE OR DELETE ON ai_evalops.evidence_references
  FOR EACH ROW EXECUTE FUNCTION ai_evalops.reject_immutable_control_mutation();

COMMENT ON TABLE ai_evalops.jobs IS 'Immutable admitted intent; mutable status belongs in job_projection and events.';
COMMENT ON TABLE ai_evalops.events IS 'Append-only digest-bound history; corrections append a later event.';
COMMENT ON COLUMN ai_evalops.effect_domain_fences.next_fencing_token IS 'Allocate and increment transactionally; every replacement receives a greater token.';
