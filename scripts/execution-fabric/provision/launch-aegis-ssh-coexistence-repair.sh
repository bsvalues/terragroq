#!/bin/sh
set -eu

BUNDLE_ROOT=/usr/local/share/williamos/aegis-ssh-coexistence-repair-bundle
SOURCE="$BUNDLE_ROOT/scripts/execution-fabric/provision/repair-aegis-ssh-coexistence.mjs"
DESTINATION=/usr/local/libexec/williamos-aegis-ssh-coexistence-repair.mjs
INSTALLER_SHA256=8fc504b5df89aa4e54b1b7d5c9ba0aeaae3c5688c04f22e0b5ed287719547c01

[ "$(id -u)" = 0 ] || { echo "AEGIS_SSH_REPAIR_ROOT_REQUIRED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$0")" = "0:0:555:regular file" ] || { echo "AEGIS_SSH_REPAIR_LAUNCHER_UNTRUSTED" >&2; exit 2; }
[ "$(stat -Lc '%u:%g:%a:%F' "$SOURCE")" = "0:0:444:regular file" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_UNTRUSTED" >&2; exit 2; }
[ "$(sha256sum "$SOURCE" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { echo "AEGIS_SSH_REPAIR_INSTALLER_DRIFT" >&2; exit 2; }
install -o root -g root -m 0555 "$SOURCE" "$DESTINATION.tmp"
[ "$(sha256sum "$DESTINATION.tmp" | cut -d ' ' -f 1)" = "$INSTALLER_SHA256" ] || { rm -f "$DESTINATION.tmp"; exit 2; }
mv -f "$DESTINATION.tmp" "$DESTINATION"
export WILLIAMOS_SSH_REPAIR_BUNDLE_ROOT="$BUNDLE_ROOT"
export WILLIAMOS_SSH_REPAIR_LAUNCHER_VERIFIED=1
exec /usr/bin/node "$DESTINATION" "$@"
