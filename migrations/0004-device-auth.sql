BEGIN;

-- Device authentication is separate from browser sessions, scoped access
-- grants, and authority grants. Raw challenges and session tokens are never
-- stored; only SHA-256 digests and Ed25519 public-key material are durable.
CREATE TABLE IF NOT EXISTS "device_credential" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "label" text NOT NULL,
  "publicKeySpki" text NOT NULL,
  "publicKeyFingerprintSha256" text NOT NULL,
  "activeAt" timestamp with time zone DEFAULT now() NOT NULL,
  "revokedAt" timestamp with time zone,
  "lastUsedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_credential_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "device_credential_fingerprint_check"
    CHECK ("device_credential"."publicKeyFingerprintSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_credential_label_check"
    CHECK (length(trim("device_credential"."label")) > 0),
  CONSTRAINT "device_credential_spki_check"
    CHECK (length("device_credential"."publicKeySpki") > 0)
);

CREATE TABLE IF NOT EXISTS "device_challenge" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "credentialId" text,
  "purpose" text NOT NULL,
  "challengeHash" text NOT NULL,
  "origin" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "consumedAt" timestamp with time zone,
  "attempts" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_challenge_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "device_challenge_credentialId_device_credential_id_fk"
    FOREIGN KEY ("credentialId") REFERENCES "device_credential"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "device_challenge_purpose_check"
    CHECK ("device_challenge"."purpose" IN ('enroll', 'authenticate')),
  CONSTRAINT "device_challenge_hash_check"
    CHECK ("device_challenge"."challengeHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_challenge_attempts_check"
    CHECK ("device_challenge"."attempts" >= 0),
  CONSTRAINT "device_challenge_expiry_check"
    CHECK ("device_challenge"."expiresAt" > "device_challenge"."createdAt"),
  CONSTRAINT "device_challenge_consumed_check"
    CHECK ("device_challenge"."consumedAt" IS NULL OR "device_challenge"."consumedAt" >= "device_challenge"."createdAt")
);

CREATE TABLE IF NOT EXISTS "device_session" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "credentialId" text NOT NULL,
  "tokenHash" text NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone,
  "lastSeenAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_session_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "device_session_credentialId_device_credential_id_fk"
    FOREIGN KEY ("credentialId") REFERENCES "device_credential"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "device_session_token_hash_check"
    CHECK ("device_session"."tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_session_expiry_check"
    CHECK ("device_session"."expiresAt" > "device_session"."createdAt"),
  CONSTRAINT "device_session_revoked_check"
    CHECK ("device_session"."revokedAt" IS NULL OR "device_session"."revokedAt" >= "device_session"."createdAt"),
  CONSTRAINT "device_session_last_seen_check"
    CHECK ("device_session"."lastSeenAt" IS NULL OR "device_session"."lastSeenAt" >= "device_session"."createdAt")
);

CREATE TABLE IF NOT EXISTS "device_auth_event" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text,
  "credentialId" text,
  "sessionId" text,
  "eventType" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "device_auth_event_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "device_auth_event_credentialId_device_credential_id_fk"
    FOREIGN KEY ("credentialId") REFERENCES "device_credential"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "device_auth_event_sessionId_device_session_id_fk"
    FOREIGN KEY ("sessionId") REFERENCES "device_session"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "device_auth_event_type_check"
    CHECK (length(trim("device_auth_event"."eventType")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_credential_fingerprint_idx"
  ON "device_credential" USING btree ("publicKeyFingerprintSha256");
CREATE INDEX IF NOT EXISTS "device_credential_user_active_idx"
  ON "device_credential" USING btree ("userId", "revokedAt", "activeAt");

CREATE UNIQUE INDEX IF NOT EXISTS "device_challenge_hash_idx"
  ON "device_challenge" USING btree ("challengeHash");
CREATE INDEX IF NOT EXISTS "device_challenge_user_purpose_created_idx"
  ON "device_challenge" USING btree ("userId", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "device_challenge_credential_purpose_created_idx"
  ON "device_challenge" USING btree ("credentialId", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "device_challenge_origin_purpose_created_idx"
  ON "device_challenge" USING btree ("origin", "purpose", "createdAt");
CREATE INDEX IF NOT EXISTS "device_challenge_expiry_idx"
  ON "device_challenge" USING btree ("expiresAt", "consumedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "device_session_token_hash_idx"
  ON "device_session" USING btree ("tokenHash");
CREATE INDEX IF NOT EXISTS "device_session_user_expiry_idx"
  ON "device_session" USING btree ("userId", "expiresAt", "revokedAt");
CREATE INDEX IF NOT EXISTS "device_session_credential_expiry_idx"
  ON "device_session" USING btree ("credentialId", "expiresAt", "revokedAt");

CREATE INDEX IF NOT EXISTS "device_auth_event_user_created_idx"
  ON "device_auth_event" USING btree ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "device_auth_event_credential_created_idx"
  ON "device_auth_event" USING btree ("credentialId", "createdAt");
CREATE INDEX IF NOT EXISTS "device_auth_event_session_created_idx"
  ON "device_auth_event" USING btree ("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "device_auth_event_type_created_idx"
  ON "device_auth_event" USING btree ("eventType", "createdAt");

COMMIT;
