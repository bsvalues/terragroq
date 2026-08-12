#!/bin/sh
set -eu

BUNDLE_ROOT=/usr/local/share/williamos/aegis-ssh-coexistence-repair-bundle
SOURCE="$BUNDLE_ROOT/scripts/execution-fabric/provision/repair-aegis-ssh-coexistence.mjs"
DESTINATION=/usr/local/libexec/williamos-aegis-ssh-coexistence-repair.mjs
LAUNCHER="$BUNDLE_ROOT/scripts/execution-fabric/provision/launch-aegis-ssh-coexistence-repair.sh"
KERNEL_LOCK=/run/lock/williamos-aegis-ssh-coexistence-repair.kernel.lock
INSTALLER_SHA256=4d651e12bed75a23865035a4b2d4e964ab533c28e4847b91cdc6030c7bb26086

[ "$(id -u)" = 0 ] || { echo "AEGIS_SSH_REPAIR_ROOT_REQUIRED" >&2; exit 2; }
[ "$(readlink -f -- "$0")" = "$LAUNCHER" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ ! -L "$LAUNCHER" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$LAUNCHER")" = "0:0:555:regular file" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ ! -L "$SOURCE" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_UNTRUSTED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$SOURCE")" = "0:0:444:regular file" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_UNTRUSTED" >&2; exit 2; }
[ "$(sha256sum "$SOURCE" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_DRIFT" >&2; exit 2; }
umask 077
[ ! -L "$KERNEL_LOCK" ] || { echo "AEGIS_SSH_REPAIR_KERNEL_LOCK_UNTRUSTED" >&2; exit 2; }
if [ "${WILLIAMOS_SSH_REPAIR_LOCK_STAGE:-}" != "LOCKED" ]; then
  if [ -e "$KERNEL_LOCK" ]; then
    [ -f "$KERNEL_LOCK" ] && [ "$(stat -Lc '%u:%g:%a' "$KERNEL_LOCK")" = "0:0:600" ] || { echo "AEGIS_SSH_REPAIR_KERNEL_LOCK_UNTRUSTED" >&2; exit 2; }
  fi
  export WILLIAMOS_SSH_REPAIR_LOCK_STAGE=LOCKED
  exec /usr/bin/flock --exclusive --nonblock --no-fork "$KERNEL_LOCK" "$LAUNCHER" "$@"
fi
[ -f "$KERNEL_LOCK" ] && [ "$(stat -Lc '%u:%g:%a' "$KERNEL_LOCK")" = "0:0:600" ] || { echo "AEGIS_SSH_REPAIR_KERNEL_LOCK_UNTRUSTED" >&2; exit 2; }
install -o root -g root -m 0555 "$SOURCE" "$DESTINATION.tmp"
[ "$(sha256sum "$DESTINATION.tmp" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { rm -f "$DESTINATION.tmp"; exit 2; }
mv -f "$DESTINATION.tmp" "$DESTINATION"
export WILLIAMOS_SSH_REPAIR_BUNDLE_ROOT="$BUNDLE_ROOT"
export WILLIAMOS_SSH_REPAIR_LAUNCHER_PATH="$LAUNCHER"
exec /usr/bin/node "$DESTINATION" "$@"
