-- Evidence: scripts/hermes-bridge/outcome-queue-source.mjs RECEIPT_COLUMN_CONTRACTS requires these receipt timestamps to be timestamp with time zone, while the legacy governance schema defines them without time zone.
BEGIN;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outcome_queue_acquisition_receipt'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "outcome_queue_acquisition_receipt"
      ALTER COLUMN "createdAt" TYPE timestamptz
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outcome_queue_acquisition_receipt'
      AND column_name = 'updatedAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "outcome_queue_acquisition_receipt"
      ALTER COLUMN "updatedAt" TYPE timestamptz
      USING "updatedAt" AT TIME ZONE 'UTC';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'outcome_queue_mutation_receipt'
      AND column_name = 'createdAt'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE "outcome_queue_mutation_receipt"
      ALTER COLUMN "createdAt" TYPE timestamptz
      USING "createdAt" AT TIME ZONE 'UTC';
  END IF;
END
$migration$;

COMMIT;
