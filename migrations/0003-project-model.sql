BEGIN;

-- Additive P1 Project model for existing WilliamOS databases.
-- This migration defines durable project context without changing or backfilling live data.
CREATE TABLE IF NOT EXISTS "project" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "lifecycle" text DEFAULT 'standby' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_user_key_unique" UNIQUE("userId","key"),
  CONSTRAINT "project_lifecycle_check" CHECK ("project"."lifecycle" IN ('active', 'standby', 'archived'))
);

CREATE TABLE IF NOT EXISTS "project_resource" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "projectId" integer NOT NULL,
  "type" text NOT NULL,
  "canonicalIdentity" text NOT NULL,
  "label" text NOT NULL,
  "relationship" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_resource_identity_unique" UNIQUE("projectId","type","canonicalIdentity","relationship"),
  CONSTRAINT "project_resource_type_check" CHECK ("project_resource"."type" IN ('repo', 'database', 'node', 'service', 'data_source')),
  CONSTRAINT "project_resource_projectId_project_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE restrict ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "project_resource_user_project_idx"
  ON "project_resource" USING btree ("userId","projectId");

CREATE INDEX IF NOT EXISTS "project_resource_user_identity_idx"
  ON "project_resource" USING btree ("userId","type","canonicalIdentity");

COMMIT;
