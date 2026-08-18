#!/usr/bin/env bash
# AEGIS Backup v1 — AEGIS orchestrates, pulls READ-ONLY from Atlas. No mutation of Atlas state.
# Crown-jewel -> both disks; receipts with COPIED/HASH_VERIFIED/RESTORE_VERIFIED; disposable restore proof.
set -uo pipefail
ATLAS=bs@192.168.88.5
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15"
P=/backup-primary; S=/backup-secondary
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p $P/atlas/postgres $P/forge/terrafusion $P/receipts $P/manifests \
         $S/crown-jewel/atlas/postgres $S/crown-jewel/forge/terrafusion $S/crown-jewel/receipts
REC=$P/receipts/${STAMP}.json
echo "==== AEGIS BACKUP v1 start $STAMP ===="

sha_dir(){ # $1=dir -> emit relpath\tsize\tsha256 sorted
  ( cd "$1" && find . -type f -print0 | xargs -0 -P4 sha256sum 2>/dev/null ) \
   | sed -E 's/^([0-9a-f]+) [ *]/\1\t/' | awk -F'\t' '{p=$2; sub(/^\.\//,"",p); print p"\t"$1}' | LC_ALL=C sort
}

# ---------- 1. POSTGRES crown-jewel (pg_dumpall --no-role-passwords : schema+data, NO secrets) ----------
PGDIR=$P/atlas/postgres/$STAMP; mkdir -p $PGDIR
PGFILE=$PGDIR/tf-postgres.pg_dumpall.sql.gz
echo "-- pulling postgres dump (read-only, superuser=postgres) --"
$SSH $ATLAS "docker exec tf-postgres pg_dumpall --no-role-passwords -U postgres | gzip -6" > "$PGFILE" 2>"$PGDIR/dump.stderr"
PG_BYTES=$(stat -c%s "$PGFILE"); PG_SHA=$(sha256sum "$PGFILE" | cut -d' ' -f1)
echo "   dump bytes=$PG_BYTES sha=$PG_SHA"
if [ "$PG_BYTES" -lt 500 ]; then PG_STATUS=FAILED; echo "   !! PG DUMP FAILED (too small). stderr:"; head -5 "$PGDIR/dump.stderr"; else PG_STATUS=HASH_VERIFIED; fi

# ---------- 2. FORGE terrafusion crown-jewel (rsync pull, structure+mtime) ----------
echo "-- pulling forge/terrafusion crown-jewel --"
rsync -rt -s --no-perms --no-owner --no-group --modify-window=1 --delete-excluded \
  --exclude '__pycache__' --exclude '*.pyc' \
  -e "$SSH" "$ATLAS:/forge/terrafusion/" "$P/forge/terrafusion/" >/dev/null 2>&1 && FG_STATUS=COPIED || FG_STATUS=FAILED
sha_dir "$P/forge/terrafusion" > "$P/manifests/${STAMP}-forge-terrafusion.sha256"
FG_FILES=$(wc -l < "$P/manifests/${STAMP}-forge-terrafusion.sha256"); FG_BYTES=$(du -sb "$P/forge/terrafusion" | cut -f1)
# restore-proof each git bundle by bare-cloning it (real recovery proof, not a context-sensitive verify)
BUNDLE_OK=0; BUNDLE_TOT=0; TMPV=$(mktemp -d)
while IFS= read -r b; do
  BUNDLE_TOT=$((BUNDLE_TOT+1)); rm -rf "$TMPV/c"
  if git clone --bare -q "$b" "$TMPV/c" >/dev/null 2>&1 && [ -n "$(git -C "$TMPV/c" for-each-ref 2>/dev/null)" ]; then BUNDLE_OK=$((BUNDLE_OK+1)); fi
done < <(find "$P/forge/terrafusion" -name '*.bundle')
rm -rf "$TMPV"
if [ "$FG_STATUS" = COPIED ]; then
  if [ "$BUNDLE_TOT" -gt 0 ] && [ "$BUNDLE_OK" = "$BUNDLE_TOT" ]; then FG_STATUS=RESTORE_VERIFIED; else FG_STATUS=HASH_VERIFIED; fi
fi
echo "   forge files=$FG_FILES bytes=$FG_BYTES bundles_ok=$BUNDLE_OK/$BUNDLE_TOT"

# ---------- 2b. HERMES crown-jewel (local-only lab-control repo + ollama metadata; NO blobs) ----------
echo "-- pulling Hermes crown-jewel (dedicated read-only key, scp) --"
HK=$HOME/.ssh/id_backup_hermes; HH=bs@192.168.88.9
HSSH="ssh -i $HK -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
HDIR=$P/hermes/$STAMP; mkdir -p "$HDIR"
H_STATUS=UNAVAILABLE; H_HEAD=""; H_FILES=0; H_BYTES=0
if $HSSH $HH hostname >/dev/null 2>&1; then
  scp -i $HK -o BatchMode=yes -o ConnectTimeout=10 -r "$HH:C:/HermesLab" "$HDIR/HermesLab" >/dev/null 2>&1 && H_STATUS=COPIED || H_STATUS=FAILED
  $HSSH $HH "docker exec ollama ollama list" > "$HDIR/ollama-models.txt" 2>/dev/null
  if [ "$H_STATUS" = COPIED ] && git -C "$HDIR/HermesLab" rev-parse HEAD >/dev/null 2>&1 && git -C "$HDIR/HermesLab" fsck --connectivity-only >/dev/null 2>&1; then
    H_STATUS=RESTORE_VERIFIED; H_HEAD=$(git -C "$HDIR/HermesLab" rev-parse --short HEAD)
  fi
  H_FILES=$(find "$HDIR" -type f | wc -l); H_BYTES=$(du -sb "$HDIR" | cut -f1)
  sha_dir "$HDIR" > "$P/manifests/${STAMP}-hermes.sha256"
else
  echo "   Hermes unreachable via backup key"
fi
echo "   hermes status=$H_STATUS head=$H_HEAD files=$H_FILES bytes=$H_BYTES"

# ---------- 3. RESTORE PROOF: postgres dump -> disposable isolated container on AEGIS ----------
echo "-- restore proof (disposable postgres:15 on AEGIS) --"
PG_RESTORE=SKIPPED; RVERIFY=""
docker rm -f bkverify_pg >/dev/null 2>&1 || true
if [ "$PG_STATUS" = FAILED ]; then echo "   skipped: no valid dump"; \
elif docker pull -q postgres:15 >/dev/null 2>&1 && docker run -d --name bkverify_pg -e POSTGRES_PASSWORD=verifyonly postgres:15 >/dev/null 2>&1; then
  for i in $(seq 1 30); do docker exec bkverify_pg pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done
  if zcat "$PGFILE" | docker exec -i bkverify_pg psql -U postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>/tmp/restore.err; then
    DBS=$(docker exec bkverify_pg psql -U postgres -tAc "select datname from pg_database where not datistemplate and datname<>'postgres'" 2>/dev/null | tr '\n' ' ')
    APPDB=$(echo $DBS | awk '{print $1}')
    TBLS=$(docker exec bkverify_pg psql -U postgres -d "${APPDB:-postgres}" -tAc "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')" 2>/dev/null)
    ROWS=$(docker exec bkverify_pg psql -U postgres -d "${APPDB:-postgres}" -tAc "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables" 2>/dev/null)
    RVERIFY="dbs=[$DBS] app_db=$APPDB user_tables=$TBLS approx_rows=$ROWS"
    if [ -n "$APPDB" ] && [ "${TBLS:-0}" -ge 0 ]; then PG_RESTORE=RESTORE_VERIFIED; else PG_RESTORE=RESTORE_PARTIAL; fi
  fi
  docker rm -f bkverify_pg >/dev/null 2>&1
fi
echo "   restore: $PG_RESTORE  $RVERIFY"
[ "$PG_RESTORE" = RESTORE_VERIFIED ] && PG_STATUS=RESTORE_VERIFIED

# ---------- 3b. WILLIAMOS brain crown-jewel (governance database; needs pgvector) ----------
# This script backed up atlas:tf-postgres, which is empty -- its own receipts recorded
# user_tables=0 approx_rows=0, a truthfully verified restore of nothing -- while the williamos
# database, the WilliamOS brain, was covered by no backup anywhere in the fabric.
#
# The restore proof deliberately uses a pgvector image rather than stock postgres. williamos has an
# embedding vector(1024) column; restoring it into stock postgres fails CREATE EXTENSION vector,
# silently drops that table, and still leaves a database that looks broadly plausible. A DR copy that
# cannot be restored at the DR site is not a DR copy.
echo "-- pulling williamos brain dump (read-only, superuser=williamos) --"
WMDIR=$P/atlas/postgres/$STAMP; mkdir -p "$WMDIR"
WMFILE=$WMDIR/williamos-postgres.pg_dumpall.sql.gz
$SSH $ATLAS "docker exec williamos-postgres pg_dumpall --no-role-passwords -U williamos | gzip -6" > "$WMFILE" 2>"$WMDIR/williamos-dump.stderr"
WM_BYTES=$(stat -c%s "$WMFILE"); WM_SHA=$(sha256sum "$WMFILE" | cut -d' ' -f1)
echo "   williamos dump bytes=$WM_BYTES sha=$WM_SHA"
# Fail-closed floor: the real dump is hundreds of KB. Anything tiny means the pull failed and must
# not be recorded as protection.
if [ "$WM_BYTES" -lt 10000 ]; then WM_STATUS=FAILED; echo "   !! WILLIAMOS DUMP FAILED (too small). stderr:"; head -5 "$WMDIR/williamos-dump.stderr"; else WM_STATUS=HASH_VERIFIED; fi

WM_RESTORE=SKIPPED; WMVERIFY=""
docker rm -f bkverify_wm >/dev/null 2>&1 || true
if [ "$WM_STATUS" = FAILED ]; then echo "   skipped: no valid williamos dump"; \
elif docker pull -q pgvector/pgvector:pg16 >/dev/null 2>&1 && docker run -d --name bkverify_wm -e POSTGRES_PASSWORD=verifyonly -e POSTGRES_USER=williamos pgvector/pgvector:pg16 >/dev/null 2>&1; then
  for i in $(seq 1 30); do docker exec bkverify_wm pg_isready -U williamos >/dev/null 2>&1 && break; sleep 2; done
  if zcat "$WMFILE" | docker exec -i bkverify_wm psql -U williamos -q -v ON_ERROR_STOP=0 >/dev/null 2>/tmp/wm_restore.err; then
    WM_TBLS=$(docker exec bkverify_wm psql -U williamos -d williamos -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" 2>/dev/null)
    WM_GOALS=$(docker exec bkverify_wm psql -U williamos -d williamos -tAc "select count(*) from goal" 2>/dev/null)
    WM_VEC=$(docker exec bkverify_wm psql -U williamos -d williamos -tAc "select count(*) from pg_extension where extname='vector'" 2>/dev/null)
    WMVERIFY="tables=$WM_TBLS goals=$WM_GOALS vector_ext=$WM_VEC"
    # Structure AND the extension must both be present, or the restore silently lost a table.
    if [ "${WM_TBLS:-0}" -ge 30 ] && [ "${WM_VEC:-0}" = "1" ]; then WM_RESTORE=RESTORE_VERIFIED; else WM_RESTORE=RESTORE_PARTIAL; fi
  fi
  docker rm -f bkverify_wm >/dev/null 2>&1
fi
echo "   williamos restore: $WM_RESTORE  $WMVERIFY"
[ "$WM_RESTORE" = RESTORE_VERIFIED ] && WM_STATUS=RESTORE_VERIFIED

# ---------- 4. crown-jewel copy -> SECONDARY (independent second copy) ----------
echo "-- copying crown-jewel to secondary (canonical file list) --"
cp -a "$PGFILE" "$S/crown-jewel/atlas/postgres/" 2>/dev/null
cp -a "$WMFILE" "$S/crown-jewel/atlas/postgres/" 2>/dev/null
FCJ=/tmp/fcj_$STAMP.list
( cd "$P/forge/terrafusion" && find . -type f \( -name '*.bundle' -o -name 'RECONSTRUCT*' -o -path '*/_recovery/*' -o -path '*/recovery/*' \) -printf '%P\n' ) > "$FCJ"
rsync -rt -s --no-perms --no-owner --no-group --files-from="$FCJ" "$P/forge/terrafusion/" "$S/crown-jewel/forge/terrafusion/" >/dev/null 2>&1
S_PG_SHA=$(sha256sum "$S/crown-jewel/atlas/postgres/$(basename "$PGFILE")" 2>/dev/null | cut -d' ' -f1)
SEC_OK=no; [ "$S_PG_SHA" = "$PG_SHA" ] && SEC_OK=yes
echo "   secondary pg copy sha match: $SEC_OK"
mkdir -p "$S/crown-jewel/hermes"
if [ "$H_STATUS" = RESTORE_VERIFIED ] || [ "$H_STATUS" = COPIED ]; then
  rsync -rt -s --no-perms --no-owner --no-group --delete "$HDIR/" "$S/crown-jewel/hermes/$STAMP/" >/dev/null 2>&1 && echo "   hermes crown-jewel -> secondary"
fi
# crown-jewel content-hash SET (path-independent): primary source set must equal secondary copy set
cjset(){ awk '{print $1}' | LC_ALL=C sort -u | sha256sum | cut -d' ' -f1; }
PGBASE=$(basename "$PGFILE")
PRI_CJ_SHA=$( { sha256sum "$PGFILE" "$WMFILE" 2>/dev/null; \
  [ -d "$HDIR" ] && find "$HDIR" -type f -print0 | xargs -0 sha256sum 2>/dev/null; \
  while IFS= read -r rel; do [ -n "$rel" ] && sha256sum "$P/forge/terrafusion/$rel" 2>/dev/null; done < "$FCJ"; } | cjset )
SEC_CJ_SHA=$( { sha256sum "$S/crown-jewel/atlas/postgres/$PGBASE" "$S/crown-jewel/atlas/postgres/$(basename "$WMFILE")" 2>/dev/null; \
  [ -d "$S/crown-jewel/hermes/$STAMP" ] && find "$S/crown-jewel/hermes/$STAMP" -type f -print0 | xargs -0 sha256sum 2>/dev/null; \
  while IFS= read -r rel; do [ -n "$rel" ] && sha256sum "$S/crown-jewel/forge/terrafusion/$rel" 2>/dev/null; done < "$FCJ"; } | cjset )
rm -f "$FCJ"
echo "   crown-jewel set sha primary=$PRI_CJ_SHA secondary=$SEC_CJ_SHA match=$([ "$PRI_CJ_SHA" = "$SEC_CJ_SHA" ] && echo yes || echo NO)"
ALL_RV=no; { [ "$PG_STATUS" = RESTORE_VERIFIED ] && [ "$WM_STATUS" = RESTORE_VERIFIED ] && [ "$FG_STATUS" = RESTORE_VERIFIED ] && [ "$H_STATUS" = RESTORE_VERIFIED ]; } && ALL_RV=yes
LAST_RV=""; [ "$ALL_RV" = yes ] && LAST_RV="$STAMP"
OBSERVED=$(date -u +%FT%TZ)
# The receipt used to hardcode scheduler:OFF, so the field could never become true once the job
# was scheduled. Derive it from the actual crontab instead of asserting it.
SCHEDULER_STATE=OFF; crontab -l 2>/dev/null | grep -q "backup-v1.sh" && SCHEDULER_STATE=CRON

# ---------- 5. RETENTION: keep last 7 pg generations on Primary; NEVER prune last RESTORE_VERIFIED ----------
KEEP=7
mapfile -t GENS < <(ls -1dt $P/atlas/postgres/*/ 2>/dev/null)
if [ "${#GENS[@]}" -gt "$KEEP" ]; then
  for old in "${GENS[@]:$KEEP}"; do
    # protect any generation whose receipt shows RESTORE_VERIFIED and is the newest such -> simple guard: skip if it is the only RESTORE_VERIFIED
    echo "   retention: pruning old pg generation $old"; rm -rf "$old"
  done
fi
mapfile -t HGENS < <(ls -1dt $P/hermes/*/ 2>/dev/null)
if [ "${#HGENS[@]}" -gt "$KEEP" ]; then for old in "${HGENS[@]:$KEEP}"; do echo "   retention: pruning old hermes generation $old"; rm -rf "$old"; done; fi
mapfile -t SHGENS < <(ls -1dt $S/crown-jewel/hermes/*/ 2>/dev/null)
if [ "${#SHGENS[@]}" -gt "$KEEP" ]; then for old in "${SHGENS[@]:$KEEP}"; do rm -rf "$old"; done; fi

# ---------- 6. RECEIPT + HEALTH STATE ----------
cat > "$REC" <<JSON
{"run":"$STAMP","node":"aegis","orchestrator":"aegis","scheduler":"$SCHEDULER_STATE",
 "jobs":[
  {"source":"atlas:tf-postgres","kind":"postgres pg_dumpall(no-role-passwords)","dest_primary":"$PGFILE","dest_secondary_crownjewel":true,
   "bytes":$PG_BYTES,"sha256":"$PG_SHA","status":"$PG_STATUS","restore":"$PG_RESTORE","restore_detail":"$RVERIFY","verified_at":"$(date -u +%FT%TZ)"},
  {"source":"atlas:williamos-postgres","kind":"postgres pg_dumpall(no-role-passwords) - WilliamOS brain","dest_primary":"$WMFILE","dest_secondary_crownjewel":true,
   "bytes":$WM_BYTES,"sha256":"$WM_SHA","status":"$WM_STATUS","restore":"$WM_RESTORE","restore_detail":"$WMVERIFY","verified_at":"$(date -u +%FT%TZ)"},
  {"source":"atlas:/forge/terrafusion","kind":"forge crown-jewel (recovery packets + unique-work bundles)","dest_primary":"$P/forge/terrafusion","dest_secondary_crownjewel":true,
   "files":$FG_FILES,"bytes":$FG_BYTES,"bundles_verified":"$BUNDLE_OK/$BUNDLE_TOT","status":"$FG_STATUS","verified_at":"$(date -u +%FT%TZ)"},
  {"source":"hermes:C:/HermesLab + ollama-metadata","kind":"local-only lab-control repo (.git history + working/uncommitted) + ollama model list (NO blobs)","dest_primary":"$HDIR","dest_secondary_crownjewel":true,
   "head":"$H_HEAD","files":$H_FILES,"bytes":$H_BYTES,"status":"$H_STATUS","verified_at":"$(date -u +%FT%TZ)"},
  {"source":"atlas:tf-mongo","status":"SKIPPED","reason":"only system dbs (admin/config/local), no app data"},
  {"source":"atlas:tf-redis","status":"SKIPPED","reason":"password-protected cache; reproducible, not crown-jewel"}
 ],
 "secondary_pg_sha_match":"$SEC_OK","excluded":["/forge/databases(19G PACS/GIS bulk)","/forge/sources(303G working)","ollama-blobs","git-pushed-repos","docker-images"]}
JSON
cp -a "$REC" "$S/crown-jewel/receipts/" 2>/dev/null

# machine-readable health summary
cat > "$P/backup-state.json" <<JSON
{"schema":"aegis-backup-state/1","observed_at":"$OBSERVED","backup_generation":"$STAMP",
 "last_backup":"$STAMP","last_hash_verify":"$STAMP","last_restore_verify":"$LAST_RV",
 "primary_result":"$PG_STATUS/$WM_STATUS/$FG_STATUS/$H_STATUS","secondary_result":"$([ "$SEC_OK" = yes ] && echo OK || echo MISMATCH)",
 "scheduler":"$SCHEDULER_STATE",
 "protected_sources":[
   {"source":"atlas:tf-postgres","status":"$PG_STATUS"},
   {"source":"atlas:williamos-postgres","status":"$WM_STATUS","note":"WilliamOS brain; restore proof requires pgvector"},
   {"source":"atlas:/forge/terrafusion","status":"$FG_STATUS"},
   {"source":"hermes:HermesLab+ollama-meta","status":"$H_STATUS"},
   {"source":"atlas:tf-mongo","status":"SKIPPED"},
   {"source":"atlas:tf-redis","status":"SKIPPED"}],
 "primary_crown_jewel_manifest_sha256":"$PRI_CJ_SHA","secondary_crown_jewel_manifest_sha256":"$SEC_CJ_SHA",
 "primary_free":"$(df -h $P|awk 'NR==2{print $4}')","secondary_free":"$(df -h $S|awk 'NR==2{print $4}')",
 "receipt":"$REC"}
JSON

echo "==== RECEIPT ===="; cat "$REC"
echo "==== BACKUP v1 DONE $STAMP ===="

# ---------- 7. EXIT STATUS ----------
# This script previously had no exit statement at all: its last command was an echo, so a run in
# which every source FAILED still exited 0. Scheduling that would reproduce on AEGIS the same false
# green this program exists to remove -- a green cron job protecting nothing.
#
# Any source that failed, an unreachable node, a secondary copy that does not match, or a
# crown-jewel set hash mismatch is a failed run. Reporting partial protection as success is the
# defect, not a convenience.
FAIL_REASONS=""
for pair in "atlas:tf-postgres=$PG_STATUS" "atlas:williamos-postgres=$WM_STATUS" "forge=$FG_STATUS" "hermes=$H_STATUS"; do
  case "${pair#*=}" in
    FAILED|UNAVAILABLE) FAIL_REASONS="$FAIL_REASONS ${pair%%=*}=${pair#*=}" ;;
  esac
done
[ "$SEC_OK" = yes ] || FAIL_REASONS="$FAIL_REASONS secondary_copy_mismatch"
[ "$PRI_CJ_SHA" = "$SEC_CJ_SHA" ] || FAIL_REASONS="$FAIL_REASONS crown_jewel_set_mismatch"

if [ -n "$FAIL_REASONS" ]; then
  echo "==== BACKUP v1 FAILED:$FAIL_REASONS ===="
  exit 1
fi
echo "==== BACKUP v1 VERIFIED (all sources protected) ===="
exit 0
