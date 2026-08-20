BEGIN;

ALTER TABLE "project_resource"
  ADD COLUMN IF NOT EXISTS "allowedOperations" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "ratifiedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "ratifiedBy" text,
  ADD COLUMN IF NOT EXISTS "resourceKey" text;

CREATE INDEX IF NOT EXISTS "project_resource_resource_key_idx"
  ON "project_resource" ("userId", "resourceKey");

ALTER TABLE "device_credential"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'owner';

DO $$ BEGIN
  ALTER TABLE "device_credential"
    ADD CONSTRAINT "device_credential_kind_check" CHECK ("kind" IN ('owner', 'runtime'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "working_world" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "intent" text NOT NULL,
  "snapshot" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "working_world_user_updated_idx"
  ON "working_world" ("userId", "updatedAt", "id");

CREATE TABLE IF NOT EXISTS "workbench_thread_message" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "threadId" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('owner', 'williamos')),
  "content" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workbench_thread_message_user_thread_fk"
    FOREIGN KEY ("userId", "threadId") REFERENCES "workbench_thread" ("userId", "id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "workbench_thread_message_thread_created_idx"
  ON "workbench_thread_message" ("userId", "threadId", "createdAt", "id");

CREATE TABLE IF NOT EXISTS "environment_world" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "resourceIdentity" text,
  "workOrderRef" text,
  "intent" text NOT NULL,
  "projection" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "environment_world_user_id_unique" UNIQUE ("userId", "id")
);
ALTER TABLE "environment_world" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;
ALTER TABLE "environment_world" ADD COLUMN IF NOT EXISTS "workOrderRef" text;
CREATE INDEX IF NOT EXISTS "environment_world_user_updated_idx"
  ON "environment_world" ("userId", "updatedAt", "id");

COMMIT;
