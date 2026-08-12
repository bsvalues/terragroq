# WilliamOS sovereign Postgres

WilliamOS state (goals, outcome queue, decisions, authority grants, governance
events, embeddings) runs on a self-hosted Postgres under lab control — not a
third-party cloud database. The database was originally Neon only because the
app was scaffolded through Vercel v0, whose default integration provisions Neon;
it was never an architecture decision. The application is portable: it speaks to
Postgres through the standard `pg` driver and the Drizzle schema in
`lib/db/schema.ts`, with nothing Neon-specific beyond the connection string.

## Requirements

- Postgres 16 with the **pgvector** extension (two `vector(1536)` embedding
  columns). The `pgvector/pgvector:pg16` image ships it.
- A `DATABASE_URL` pointing at the sovereign database.

## Bootstrap a fresh database

`drizzle/0000_williamos_init.sql` is the committed schema bootstrap: it enables
`vector` and creates the full table set. Apply it to a fresh database with:

```bash
DATABASE_URL="postgres://…" npm run db:apply
```

The apply refuses to run against a database that already has public tables unless
`WILLIAMOS_DB_APPLY_FORCE=1` is set (this bootstrap is for a fresh, empty
sovereign database, not incremental migrations).

## Regenerating the DDL

There is no in-repo `drizzle-kit` dependency (the repo tree carries multiple
`esbuild` versions whose postinstall self-check collides). Regenerate the DDL
from `lib/db/schema.ts` with an isolated tool install:

```bash
mkdir -p /tmp/dkgen && cd /tmp/dkgen && npm init -y >/dev/null
npm i -D drizzle-kit@0.31.6 drizzle-orm@0.45.2
cat > drizzle.config.ts <<'CFG'
import { defineConfig } from "drizzle-kit"
export default defineConfig({
  schema: "<repo>/lib/db/schema.ts",
  out: "/tmp/dkgen/out",
  dialect: "postgresql",
})
CFG
npx drizzle-kit generate
```

Then prepend `CREATE EXTENSION IF NOT EXISTS vector;` (and a
`--> statement-breakpoint`) to the generated SQL and replace
`drizzle/0000_williamos_init.sql`.

## Scope

This is the host-independent schema layer. Standing up the sovereign Postgres
container on its host, repointing `DATABASE_URL`, migrating existing data, and
decommissioning Neon are separate, sequenced changes.
