BEGIN;

-- One-time device links: an already-authenticated device mints a short-lived code that a second
-- device redeems once to receive its own session. This is the sign-in path that does not depend on
-- WebAuthn, platform authenticators, or anything the operating system may or may not expose.
--
-- Only a SHA-256 digest of the code is stored, so a database reader cannot redeem a pending link.
CREATE TABLE IF NOT EXISTS "device_link" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "tokenSha256" text NOT NULL,
  "label" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "consumedAt" timestamp with time zone,
  CONSTRAINT "device_link_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "device_link_token_check" CHECK ("device_link"."tokenSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "device_link_window_check" CHECK ("device_link"."expiresAt" > "device_link"."createdAt")
);

-- Redemption looks a link up by digest exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS "device_link_tokenSha256_key" ON "device_link" ("tokenSha256");

-- Listing and cleanup for one operator.
CREATE INDEX IF NOT EXISTS "device_link_userId_idx" ON "device_link" ("userId");

COMMIT;
