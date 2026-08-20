-- 0012: the WorkingWorldSnapshot store (S6, #762).
--
-- A workspace is the current working world: assembled when work is named, restored meaningfully on
-- "where were we". The snapshot column holds MEANING (validated against chrome at the application
-- boundary); it never holds layout. One row per world; worlds are cheap and the owner never manages
-- them as objects.

CREATE TABLE "working_world" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "intent" text NOT NULL,
  "snapshot" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "working_world_user_updated_idx" ON "working_world" ("userId", "updatedAt", "id");
