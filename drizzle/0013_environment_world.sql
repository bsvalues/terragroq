BEGIN;

CREATE TABLE IF NOT EXISTS "environment_world" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "resourceIdentity" text,
  "intent" text NOT NULL,
  "projection" jsonb NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "environment_world_user_id_unique" UNIQUE("userId", "id")
);

CREATE INDEX IF NOT EXISTS "environment_world_user_updated_idx"
  ON "environment_world" ("userId", "updatedAt", "id");

COMMIT;
