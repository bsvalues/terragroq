BEGIN;

-- WebAuthn passkeys for the Primary Operator (issue #803).
--
-- Fields mirror the Better Auth passkey model exactly: name, publicKey, userId,
-- credentialID, counter, deviceType, backedUp, transports, createdAt, aaguid.
-- Nothing secret is stored: a passkey's private key never leaves the authenticator
-- (the device TPM or secure enclave), so this table holds only public key material
-- and the signature counter used to detect cloned authenticators.
CREATE TABLE IF NOT EXISTS "passkey" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL,
  "credentialID" text NOT NULL,
  "counter" integer NOT NULL DEFAULT 0,
  "deviceType" text NOT NULL,
  "backedUp" boolean NOT NULL DEFAULT false,
  "transports" text,
  "aaguid" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "passkey_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "passkey_counter_check" CHECK ("passkey"."counter" >= 0)
);

-- A credential id identifies exactly one authenticator registration.
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentialID_key" ON "passkey" ("credentialID");

-- Sign-in resolves a credential to its owner; enrollment lists an operator's devices.
CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("userId");

COMMIT;
