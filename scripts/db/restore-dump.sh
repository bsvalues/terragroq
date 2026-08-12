#!/usr/bin/env bash
# Restore a Neon logical dump into the target (ATLAS) WilliamOS Postgres.
#
# Usage:
#   TARGET_URL="postgres://user:pass@atlas-host:15432/williamos" \
#   DUMP_PATH="/path/to/neon-dump.dump"  bash scripts/db/restore-dump.sh
#
# Supports pg_dump custom/-Fc/directory dumps (pg_restore) and plain .sql/.sql.gz (psql).
# Ensures the pgvector extension exists first. Refuses a non-empty target unless FORCE=1.
# The connection string is passed through the environment; it is never echoed.
set -uo pipefail

: "${TARGET_URL:?TARGET_URL is required (postgres connection string for the ATLAS WilliamOS database)}"
: "${DUMP_PATH:?DUMP_PATH is required (path to the Neon logical dump)}"
[ -f "$DUMP_PATH" ] || { echo "dump file not found: $DUMP_PATH" >&2; exit 1; }

echo "dump: $DUMP_PATH"
echo "dump sha256: $(sha256sum "$DUMP_PATH" | awk '{print $1}')"
echo "dump bytes: $(stat -c%s "$DUMP_PATH" 2>/dev/null || wc -c < "$DUMP_PATH")"

existing=$(psql "$TARGET_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';") \
  || { echo "cannot reach target database" >&2; exit 1; }
existing=${existing//[[:space:]]/}
if [ "${existing:-0}" -gt 0 ] && [ "${FORCE:-0}" != "1" ]; then
  echo "target already has ${existing} public table(s); this restore expects a fresh database. Set FORCE=1 to override." >&2
  exit 2
fi

echo "ensuring pgvector extension..."
psql "$TARGET_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

case "$DUMP_PATH" in
  *.sql)
    psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f "$DUMP_PATH" ;;
  *.sql.gz)
    gunzip -c "$DUMP_PATH" | psql "$TARGET_URL" -v ON_ERROR_STOP=1 ;;
  *)
    pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_URL" "$DUMP_PATH" ;;
esac

restored=$(psql "$TARGET_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
echo "restore complete; target now has ${restored//[[:space:]]/} table(s)."
echo "Next: verify with scripts/db/db-state-manifest.mjs against both source and target, then --compare."
