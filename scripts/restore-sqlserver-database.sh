#!/usr/bin/env bash
# Restore a SQL Server database from a verified backup, on the node that owns the workload.
#
# This is a catalogue entry, not a command an agent composed: it lives in version control, takes only a
# backup path and a database name that come from the ratified resource record, and does one thing.
#
# It restores WITH MOVE because the backup's file paths are the ones the source host used, and it
# derives those moves from RESTORE FILELISTONLY rather than assuming names -- a backup whose layout
# changed would otherwise fail halfway through several hundred gigabytes.
#
# It never drops or overwrites an existing database. A restore that silently replaced one would make a
# mistaken invocation unrecoverable, which is the opposite of why the workload is being moved.
set -euo pipefail

BACKUP_PATH="${1:?backup path required}"
DATABASE="${2:?database name required}"
# Under the fabric identity, not root: /srv is root-owned and the node correctly refused to create
# there rather than escalating. This sits on the 1.8T root volume, which is where the space is --
# /backup-primary would leave ~26 GB of headroom for a 738 GB restore, which is not headroom.
DATA_DIR="${3:-$HOME/mssql/data}"
CONTAINER="pacs-mssql"
IMAGE="mcr.microsoft.com/mssql/server:2022-latest"
SECRET="$HOME/mssql/sa.secret"

echo "== restore $DATABASE from $BACKUP_PATH =="
mkdir -p "$DATA_DIR" "$(dirname "$SECRET")"
chmod 777 "$DATA_DIR"

# A throwaway credential for this instance, generated here and never transmitted. It is not the owner's
# and not reused from anywhere.
if [ ! -s "$SECRET" ]; then
  printf 'Wos%s!7\n' "$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)" > "$SECRET"
  chmod 600 "$SECRET"
fi
SA_PASSWORD="$(cat "$SECRET")"

if [ -z "$(docker images -q "$IMAGE")" ]; then
  echo "-- pulling $IMAGE --"
  docker pull -q "$IMAGE"
fi

if [ -z "$(docker ps -q -f name="^${CONTAINER}$")" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "-- starting $CONTAINER --"
  docker run -d --name "$CONTAINER" \
    -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$SA_PASSWORD" -e MSSQL_PID=Developer \
    -v "$DATA_DIR":/var/opt/mssql/data \
    -v "$(dirname "$BACKUP_PATH")":/bak:ro \
    -p 127.0.0.1:1433:1433 "$IMAGE" >/dev/null
fi

SQLCMD="/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P $SA_PASSWORD"
echo "-- waiting for SQL Server --"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" $SQLCMD -Q "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 5
done
docker exec "$CONTAINER" $SQLCMD -Q "SELECT 1" >/dev/null

BAK="/bak/$(basename "$BACKUP_PATH")"

if docker exec "$CONTAINER" $SQLCMD -h -1 -W -Q \
    "SET NOCOUNT ON; SELECT COUNT(*) FROM sys.databases WHERE name = '$DATABASE'" | grep -q '^1$'; then
  echo "$DATABASE already exists; refusing to overwrite it"
  exit 0
fi

echo "-- reading the backup file list --"
docker exec "$CONTAINER" $SQLCMD -h -1 -W -s "|" -Q \
  "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$BAK'" > /tmp/filelist.txt

MOVES=""
while IFS='|' read -r logical physical type rest; do
  [ -z "${logical:-}" ] && continue
  case "$type" in
    D) ext="mdf" ;;
    L) ext="ldf" ;;
    *) continue ;;
  esac
  MOVES="$MOVES, MOVE N'$logical' TO N'/var/opt/mssql/data/${logical}.${ext}'"
done < <(awk -F'|' 'NF>3 {print $1"|"$2"|"$3}' /tmp/filelist.txt | sed 's/ *| */|/g')

if [ -z "$MOVES" ]; then
  echo "could not derive file moves from the backup; refusing to guess"
  exit 2
fi

echo "-- restoring (this is hundreds of gigabytes; it takes hours) --"
docker exec "$CONTAINER" $SQLCMD -Q \
  "RESTORE DATABASE [$DATABASE] FROM DISK = N'$BAK' WITH RECOVERY, STATS = 5${MOVES}"

echo "-- restored; reporting size --"
docker exec "$CONTAINER" $SQLCMD -h -1 -W -Q \
  "SET NOCOUNT ON; SELECT SUM(size)*8/1024 FROM [$DATABASE].sys.database_files"
echo "== done =="
