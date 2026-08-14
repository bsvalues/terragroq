BEGIN;

-- Additive Workbench context registry. Existing goals, outcomes, work orders,
-- evidence, decisions, and events remain authoritative source records.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_user_id_unique'
      AND conrelid = 'project'::regclass
  ) THEN
    ALTER TABLE "project"
      ADD CONSTRAINT "project_user_id_unique" UNIQUE("userId","id");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workbench_thread" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "projectId" integer NOT NULL,
  "title" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbench_thread_user_id_unique" UNIQUE("userId","id"),
  CONSTRAINT "workbench_thread_user_project_fk"
    FOREIGN KEY ("userId","projectId") REFERENCES "project"("userId","id") ON DELETE restrict ON UPDATE no action
);

CREATE TABLE IF NOT EXISTS "workbench_thread_source" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "threadId" text NOT NULL,
  "sourceType" text NOT NULL,
  "sourceId" text NOT NULL,
  "role" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workbench_thread_source_binding_unique" UNIQUE("userId","threadId","sourceType","sourceId"),
  CONSTRAINT "workbench_thread_source_type_check" CHECK ("workbench_thread_source"."sourceType" IN ('goal', 'outcome')),
  CONSTRAINT "workbench_thread_source_role_check" CHECK ("workbench_thread_source"."role" IN ('root', 'member')),
  CONSTRAINT "workbench_thread_source_user_thread_fk"
    FOREIGN KEY ("userId","threadId") REFERENCES "workbench_thread"("userId","id") ON DELETE cascade ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "workbench_thread_user_project_updated_idx"
  ON "workbench_thread" USING btree ("userId","projectId","updatedAt","id");

CREATE UNIQUE INDEX IF NOT EXISTS "workbench_thread_source_root_unique_idx"
  ON "workbench_thread_source" USING btree ("userId","sourceType","sourceId")
  WHERE "workbench_thread_source"."role" = 'root';

CREATE UNIQUE INDEX IF NOT EXISTS "workbench_thread_source_thread_root_unique_idx"
  ON "workbench_thread_source" USING btree ("userId","threadId")
  WHERE "workbench_thread_source"."role" = 'root';

COMMIT;
