-- WILLIAMOS_MIGRATION:issue-911-live-nonempty-acceptance.v1
BEGIN;

ALTER TABLE "goal"
  ADD COLUMN IF NOT EXISTS "acceptedContractIds" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "outcome_queue_item"
  ADD COLUMN IF NOT EXISTS "acceptedContractIds" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "goal_outcome_intake_receipt"
  ADD COLUMN IF NOT EXISTS "acceptedContractIds" text[] NOT NULL DEFAULT '{}'::text[];

DO $column_contract$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'goal',
    'outcome_queue_item',
    'goal_outcome_intake_receipt'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = relation_name
        AND column_name = 'acceptedContractIds'
        AND data_type = 'ARRAY'
        AND udt_name = '_text'
        AND is_nullable = 'NO'
        AND column_default = '''{}''::text[]'
    ) THEN
      RAISE EXCEPTION 'ISSUE_911_LIVE_ACCEPTANCE_COLUMN_SHAPE_WALL:%', relation_name;
    END IF;
  END LOOP;
END
$column_contract$;

CREATE UNIQUE INDEX IF NOT EXISTS goal_issue_911_live_acceptance_singleton_idx
  ON "goal" ("userId")
  WHERE "acceptedContractIds" = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[];

CREATE UNIQUE INDEX IF NOT EXISTS outcome_queue_item_issue_911_live_acceptance_singleton_idx
  ON "outcome_queue_item" ("userId")
  WHERE "acceptedContractIds" = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[];

CREATE UNIQUE INDEX IF NOT EXISTS goal_intake_issue_911_live_acceptance_singleton_idx
  ON "goal_outcome_intake_receipt" ("userId")
  WHERE "acceptedContractIds" = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[];

DO $migration$
DECLARE
  relation_name text;
  index_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'goal',
    'outcome_queue_item',
    'goal_outcome_intake_receipt'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = relation_name
        AND column_name = 'acceptedContractIds'
        AND data_type = 'ARRAY'
        AND udt_name = '_text'
        AND is_nullable = 'NO'
        AND column_default = '''{}''::text[]'
    ) THEN
      RAISE EXCEPTION 'ISSUE_911_LIVE_ACCEPTANCE_COLUMN_SHAPE_WALL:%', relation_name;
    END IF;
  END LOOP;

  FOREACH index_name IN ARRAY ARRAY[
    'goal_issue_911_live_acceptance_singleton_idx',
    'outcome_queue_item_issue_911_live_acceptance_singleton_idx',
    'goal_intake_issue_911_live_acceptance_singleton_idx'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS idx ON idx.oid = i.indexrelid
      JOIN pg_class AS rel ON rel.oid = i.indrelid
      JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = current_schema()
        AND idx.relname = index_name
        AND i.indisunique
        AND i.indnkeyatts = 1
        AND (SELECT att.attname
             FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
             JOIN pg_attribute AS att ON att.attrelid = i.indrelid AND att.attnum = key.attnum
             WHERE key.ordinality = 1) = 'userId'
        AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[ ()[:space:]]', '', 'g')
          = '"acceptedContractIds"=ARRAY[''issue-911-live-nonempty-acceptance.v1''::text]'
    ) THEN
      RAISE EXCEPTION 'ISSUE_911_LIVE_ACCEPTANCE_INDEX_SHAPE_WALL:%', index_name;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
