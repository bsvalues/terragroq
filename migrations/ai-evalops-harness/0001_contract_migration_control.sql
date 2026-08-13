-- AEH migration fixture: contract only after old-reader drain and compatibility proof.
ALTER TABLE ai_evalops.schema_release
  ALTER COLUMN compatibility_floor SET NOT NULL;
