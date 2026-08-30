-- 0014: provenance-bound historical knowledge promotion.
--
-- Doctrine portion: historical inputs remain non-authoritative, inactive, and
-- outside ordinary Doctrine mutation and supersession lifecycles.

BEGIN;

ALTER TABLE "doctrine"
  ADD COLUMN IF NOT EXISTS "historicalCandidateId" text,
  ADD COLUMN IF NOT EXISTS "historicalClaimId" text,
  ADD COLUMN IF NOT EXISTS "historicalProvenance" jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS "doctrine_historical_candidate_user_idx"
  ON "doctrine" ("userId", "historicalCandidateId")
  WHERE "historicalCandidateId" IS NOT NULL;

DO $historical_doctrine_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctrine_historical_identity_check'
      AND conrelid = 'doctrine'::regclass
  ) THEN
    ALTER TABLE "doctrine"
      ADD CONSTRAINT "doctrine_historical_identity_check" CHECK (
        (
          "historicalCandidateId" IS NULL
          AND "historicalClaimId" IS NULL
          AND "historicalProvenance" IS NULL
          AND "status" NOT IN ('historical_input', 'historical_archived')
        ) OR (
          "historicalCandidateId" IS NOT NULL
          AND "historicalClaimId" IS NOT NULL
          AND "historicalProvenance" IS NOT NULL
          AND "status" IN ('historical_input', 'historical_archived')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doctrine_historical_safety_check'
      AND conrelid = 'doctrine'::regclass
  ) THEN
    ALTER TABLE "doctrine"
      ADD CONSTRAINT "doctrine_historical_safety_check" CHECK (
        "historicalCandidateId" IS NULL OR (
          "active" = false
          AND "priority" = 0
          AND cardinality("allowed") = 0
          AND cardinality("forbidden") = 0
          AND cardinality("requiresApproval") = 0
          AND "locked" = false
          AND "supersedesId" IS NULL
          AND "supersededById" IS NULL
          AND COALESCE("historicalProvenance"->>'authority', '') = 'historical_non_authoritative'
        )
      );
  END IF;
END
$historical_doctrine_constraints$;

-- Private Project/Thread context portion. These records remain outside the
-- indexed corpus and cannot become executable or authoritative.
DO $historical_document_columns$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'projectId') THEN
    ALTER TABLE "document" ADD COLUMN "projectId" integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'threadId') THEN
    ALTER TABLE "document" ADD COLUMN "threadId" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'historicalCandidateId') THEN
    ALTER TABLE "document" ADD COLUMN "historicalCandidateId" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'historicalClaimId') THEN
    ALTER TABLE "document" ADD COLUMN "historicalClaimId" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'historicalProvenance') THEN
    ALTER TABLE "document" ADD COLUMN "historicalProvenance" jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'privacy') THEN
    ALTER TABLE "document" ADD COLUMN "privacy" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'authority') THEN
    ALTER TABLE "document" ADD COLUMN "authority" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'executionMode') THEN
    ALTER TABLE "document" ADD COLUMN "executionMode" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'archivedAt') THEN
    ALTER TABLE "document" ADD COLUMN "archivedAt" timestamp with time zone;
  END IF;
END
$historical_document_columns$;

DO $historical_document_index$
BEGIN
  IF to_regclass('document_historical_candidate_user_idx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX "document_historical_candidate_user_idx" ON "document" ("userId", "historicalCandidateId") WHERE "historicalCandidateId" IS NOT NULL';
  END IF;
END
$historical_document_index$;

DO $historical_document_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'workbench_thread'::regclass
      AND conname = 'workbench_thread_user_project_id_unique'
  ) THEN
    ALTER TABLE "workbench_thread"
      ADD CONSTRAINT "workbench_thread_user_project_id_unique"
      UNIQUE ("userId", "projectId", "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document'::regclass
      AND conname = 'document_historical_user_project_fk'
  ) THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_historical_user_project_fk"
      FOREIGN KEY ("userId", "projectId") REFERENCES "project"("userId", "id") ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document'::regclass
      AND conname = 'document_historical_user_thread_fk'
  ) THEN
    ALTER TABLE "document"
      DROP CONSTRAINT "document_historical_user_thread_fk";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document'::regclass
      AND conname = 'document_historical_user_project_thread_fk'
  ) THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_historical_user_project_thread_fk"
      FOREIGN KEY ("userId", "projectId", "threadId")
      REFERENCES "workbench_thread"("userId", "projectId", "id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document'::regclass
      AND conname = 'document_historical_identity_check'
  ) THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_historical_identity_check" CHECK (
        (
          "historicalCandidateId" IS NULL
          AND "historicalClaimId" IS NULL
          AND "historicalProvenance" IS NULL
          AND "projectId" IS NULL
          AND "threadId" IS NULL
          AND "privacy" IS NULL
          AND "authority" IS NULL
          AND "executionMode" IS NULL
          AND "archivedAt" IS NULL
          AND "status" NOT IN ('private_project_context', 'archived_private_project_context')
        ) OR (
          "historicalCandidateId" IS NOT NULL
          AND "historicalClaimId" IS NOT NULL
          AND "historicalProvenance" IS NOT NULL
          AND "projectId" IS NOT NULL
          AND "privacy" IS NOT NULL
          AND "authority" IS NOT NULL
          AND "executionMode" IS NOT NULL
          AND "status" IN ('private_project_context', 'archived_private_project_context')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document'::regclass
      AND conname = 'document_historical_safety_check'
  ) THEN
    ALTER TABLE "document"
      ADD CONSTRAINT "document_historical_safety_check" CHECK (
        "historicalCandidateId" IS NULL OR (
          "chunkCount" = 0
          AND "privacy" = 'private'
          AND "authority" = 'historical_non_authoritative'
          AND "executionMode" = 'non_executing'
          AND COALESCE("historicalProvenance"->>'privacy', '') = 'private'
          AND COALESCE("historicalProvenance"->>'authority', '') = 'historical_non_authoritative'
          AND COALESCE("historicalProvenance"->>'executionMode', '') = 'non_executing'
          AND (
            ("status" = 'private_project_context' AND "archivedAt" IS NULL)
            OR ("status" = 'archived_private_project_context' AND "archivedAt" IS NOT NULL)
          )
        )
      );
  END IF;
END
$historical_document_constraints$;

CREATE OR REPLACE FUNCTION "lock_historical_document_chunk_invariant"(
  "documentId" integer,
  "schemaName" text
)
RETURNS void
LANGUAGE plpgsql
AS $lock_historical_document_chunk_invariant_body$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('williamos:historical-document-chunk:' || "schemaName"),
    "documentId"
  );
END
$lock_historical_document_chunk_invariant_body$;

CREATE OR REPLACE FUNCTION "reject_historical_document_chunk"()
RETURNS trigger
LANGUAGE plpgsql
AS $reject_historical_document_chunk_body$
BEGIN
  PERFORM "lock_historical_document_chunk_invariant"(NEW."documentId", TG_TABLE_SCHEMA);
  IF EXISTS (
    SELECT 1
    FROM "document" d
    WHERE d."id" = NEW."documentId"
      AND (
        d."historicalCandidateId" IS NOT NULL
        OR d."status" IN ('private_project_context', 'archived_private_project_context')
      )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PROJECT_CONTEXT_CHUNK_FORBIDDEN';
  END IF;
  RETURN NEW;
END
$reject_historical_document_chunk_body$;

CREATE OR REPLACE FUNCTION "reject_historical_document_with_chunks"()
RETURNS trigger
LANGUAGE plpgsql
AS $reject_historical_document_with_chunks_body$
BEGIN
  PERFORM "lock_historical_document_chunk_invariant"(NEW."id", TG_TABLE_SCHEMA);
  IF (
    NEW."historicalCandidateId" IS NOT NULL
    OR NEW."status" IN ('private_project_context', 'archived_private_project_context')
  ) AND (
    NEW."chunkCount" <> 0
    OR EXISTS (
      SELECT 1 FROM "document_chunk" dc WHERE dc."documentId" = NEW."id"
    )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_PROJECT_CONTEXT_CHUNK_FORBIDDEN';
  END IF;
  RETURN NEW;
END
$reject_historical_document_with_chunks_body$;

DO $historical_document_chunk_triggers$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'document_chunk_reject_historical_insert'
      AND tgrelid = 'document_chunk'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER "document_chunk_reject_historical_insert" BEFORE INSERT OR UPDATE OF "documentId" ON "document_chunk" FOR EACH ROW EXECUTE FUNCTION "reject_historical_document_chunk"()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'document_reject_historical_with_chunks'
      AND tgrelid = 'document'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER "document_reject_historical_with_chunks" BEFORE INSERT OR UPDATE OF "status", "historicalCandidateId", "chunkCount" ON "document" FOR EACH ROW EXECUTE FUNCTION "reject_historical_document_with_chunks"()';
  END IF;
END
$historical_document_chunk_triggers$;

COMMIT;
