#!/bin/sh
set -eu

BUNDLE_ROOT=/usr/local/share/williamos/aegis-ssh-coexistence-repair-bundle
SOURCE="$BUNDLE_ROOT/scripts/execution-fabric/provision/repair-aegis-ssh-coexistence.mjs"
DESTINATION=/usr/local/libexec/williamos-aegis-ssh-coexistence-repair.mjs
LAUNCHER="$BUNDLE_ROOT/scripts/execution-fabric/provision/launch-aegis-ssh-coexistence-repair.sh"
KERNEL_LOCK=/run/lock/williamos-aegis-ssh-coexistence-repair.kernel.lock
INSTALLER_SHA256=5630aa2bb2be587f93b79c146fc0f33e96709ee1e8843bfe79e275de23e2742d

[ "$(id -u)" = 0 ] || { echo "AEGIS_SSH_REPAIR_ROOT_REQUIRED" >&2; exit 2; }
[ "$(readlink -f -- "$0")" = "$LAUNCHER" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$LAUNCHER")" = "0:0:555:regular file" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$SOURCE")" = "0:0:444:regular file" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_UNTRUSTED" >&2; exit 2; }
[ "$(sha256sum "$SOURCE" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_DRIFT" >&2; exit 2; }
umask 077
exec 9>>"$KERNEL_LOCK"
[ "$(stat -Lc '%u:%g:%a:%F' "$KERNEL_LOCK")" = "0:0:600:regular file" ] || { echo "AEGIS_SSH_REPAIR_KERNEL_LOCK_UNTRUSTED" >&2; exit 2; }
/usr/bin/flock -n 9 || { echo "AEGIS_SSH_REPAIR_RESERVATION_BUSY" >&2; exit 2; }
install -o root -g root -m 0555 "$SOURCE" "$DESTINATION.tmp"
[ "$(sha256sum "$DESTINATION.tmp" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { rm -f "$DESTINATION.tmp"; exit 2; }
mv -f "$DESTINATION.tmp" "$DESTINATION"
export WILLIAMOS_SSH_REPAIR_BUNDLE_ROOT="$BUNDLE_ROOT"
export WILLIAMOS_SSH_REPAIR_LAUNCHER_PATH="$LAUNCHER"
export WILLIAMOS_SSH_REPAIR_KERNEL_LOCK_FD=9
exec /usr/bin/node "$DESTINATION" "$@"
