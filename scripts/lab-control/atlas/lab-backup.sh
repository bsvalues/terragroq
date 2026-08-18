#!/usr/bin/env bash
# Atlas lab backup.
#
# Replaces backup-volumes.sh, which tarred live Docker volumes. Three things were wrong with that
# and each is addressed here:
#
#   1. It enumerated `docker volume ls`, so every bind-mounted data directory was invisible --
#      including the converted PACS corpus at /forge/pacs-pg2. The largest asset on the machine was
#      not in the backup set at all. Databases are now enumerated from the running containers.
#   2. It tarred the data directories of RUNNING postgres and mongo. A tar is not atomic, so the
#      files move underneath it: the result is not a consistent snapshot and not even reliably
#      crash-consistent. Databases are now dumped logically, which is consistent by MVCC.
#   3. It wrote to /home/bs/backups, on the same block device as /var/lib/docker/volumes. Backups
#      that share a device with their source do not survive the failure they exist for. Output now
#      goes to /forge, a different device.
#
# It also reported OK on tar's exit status alone. Every artifact here is parsed after writing --
# the container's pg_restore --list actually reads the archive's table of contents (the host has no
# postgres client installed) -- so "OK" means the file was
# readable as what it claims to be, not merely that the writer did not error.
set -uo pipefail

DEST_ROOT="${LAB_BACKUP_DEST:-/forge/backups/nightly}"
RETENTION_DAYS="${LAB_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$DEST_ROOT/$STAMP"
STATUS_FILE="$DEST_ROOT/last-run.json"
failures=0
artifacts=0

mkdir -p "$DEST" || { echo "FATAL: cannot create $DEST"; exit 2; }
echo "===== lab backup $STAMP -> $DEST ====="

note_fail() { echo "  FAIL $*"; failures=$((failures+1)); }
note_ok()   { echo "  OK   $*"; artifacts=$((artifacts+1)); }

# --- postgres, logically, per database -------------------------------------------------------
# superuser differs per container: the williamos PGDATA was restored with its own role.
dump_postgres() {
  local container="$1" superuser="$2"
  docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true || {
    note_fail "$container is not running -- nothing dumped"
    return
  }
  local dbs
  dbs="$(docker exec "$container" psql -U "$superuser" -d postgres -Atc \
    "select datname from pg_database where not datistemplate and datallowconn" 2>/dev/null)"
  if [ -z "$dbs" ]; then note_fail "$container: could not list databases"; return; fi
  local db out
  for db in $dbs; do
    out="$DEST/${container}--${db}.dump"
    if docker exec "$container" pg_dump -U "$superuser" -Fc -d "$db" > "$out" 2>/dev/null \
       && [ -s "$out" ] \
       && docker exec -i "$container" pg_restore --list < "$out" >/dev/null 2>&1; then
      note_ok "${container}/${db} ($(du -h "$out" | cut -f1)) toc-verified"
    else
      note_fail "${container}/${db}"
      rm -f "$out"
    fi
  done
}

dump_postgres williamos-postgres williamos
dump_postgres tf-postgres postgres

# --- mongo ------------------------------------------------------------------------------------
if docker inspect -f '{{.State.Running}}' tf-mongo 2>/dev/null | grep -q true; then
  if docker exec tf-mongo sh -c 'mongodump --archive --gzip' > "$DEST/tf-mongo.archive.gz" 2>/dev/null \
     && [ -s "$DEST/tf-mongo.archive.gz" ] \
     && gzip -t "$DEST/tf-mongo.archive.gz" 2>/dev/null; then
    note_ok "tf-mongo ($(du -h "$DEST/tf-mongo.archive.gz" | cut -f1)) gzip-verified"
  else
    note_fail tf-mongo
    rm -f "$DEST/tf-mongo.archive.gz"
  fi
else
  note_fail "tf-mongo is not running -- nothing dumped"
fi

# --- redis ------------------------------------------------------------------------------------
# Small today, but a silent zero-byte redis backup is the same failure mode as the rest.
if docker inspect -f '{{.State.Running}}' tf-redis 2>/dev/null | grep -q true; then
  if docker exec tf-redis redis-cli SAVE >/dev/null 2>&1 \
     && docker exec tf-redis sh -c 'cat /data/dump.rdb' > "$DEST/tf-redis.rdb" 2>/dev/null \
     && [ -s "$DEST/tf-redis.rdb" ] \
     && head -c 5 "$DEST/tf-redis.rdb" | grep -q REDIS; then
    note_ok "tf-redis ($(du -h "$DEST/tf-redis.rdb" | cut -f1)) magic-verified"
  else
    note_fail tf-redis
    rm -f "$DEST/tf-redis.rdb"
  fi
else
  note_fail "tf-redis is not running -- nothing dumped"
fi

# --- coverage report ------------------------------------------------------------------------------
# The predecessor's defining failure was reporting success for a set that silently excluded the
# data that mattered. Enumerating only what we back up reproduces that. So enumerate what we do
# NOT: every named volume without a logical dump, and every bind-mounted database directory. These
# are listed as UNCOVERED on every run, whether or not anyone has decided what to do about them.
echo "  --- coverage ---"
covered_hint="williamos-postgres tf-postgres tf-mongo tf-redis"
for vol in $(docker volume ls --format '{{.Name}}' 2>/dev/null); do
  case "$vol" in
    *[!0-9a-f]* ) : ;;
    ????????????????????????????????????????????????????????????????) continue ;;
  esac
  used_by="$(docker ps -a --filter "volume=$vol" --format '{{.Names}}' 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
  running=0
  for c in $covered_hint; do
    case ",$used_by," in *",$c,"*) running=1 ;; esac
  done
  [ "$running" -eq 1 ] && continue
  echo "  UNCOVERED volume $vol (containers: ${used_by:-none}) -- no logical dump taken"
done
for d in /forge/pacs-pg /forge/pacs-pg2 /forge/mssql; do
  [ -d "$d" ] || continue
  echo "  UNCOVERED bind-dir $d ($(sudo -n du -sh "$d" 2>/dev/null | cut -f1 || echo 'size unreadable')) -- not in any backup set"
done

# --- integrity manifest -------------------------------------------------------------------------
( cd "$DEST" && sha256sum ./* > SHA256SUMS 2>/dev/null ) && echo "  manifest written"

# --- retention ----------------------------------------------------------------------------------
# Never prune when the current run produced nothing: a broken backup must not eat the last good one.
if [ "$artifacts" -gt 0 ] && [ "$failures" -eq 0 ]; then
  find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -print -exec rm -rf {} + \
    | sed 's/^/  pruned /'
else
  echo "  retention SKIPPED -- this run had $failures failure(s); keeping all history"
fi

total="$(du -sh "$DEST" 2>/dev/null | cut -f1)"
cat > "$STATUS_FILE" <<JSON
{"ranAt":"$(date -Is)","stamp":"$STAMP","dest":"$DEST","artifacts":$artifacts,"failures":$failures,"size":"$total","ok":$([ "$failures" -eq 0 ] && echo true || echo false)}
JSON

echo "done $STAMP -- $artifacts artifact(s), $failures failure(s), $total"
[ "$failures" -eq 0 ] || echo "BACKUP RUN DEGRADED: $failures failure(s)"
exit $([ "$failures" -eq 0 ] && echo 0 || echo 1)
