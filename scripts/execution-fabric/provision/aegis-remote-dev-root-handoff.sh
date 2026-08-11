#!/bin/bash
set -u -o pipefail
umask 077

readonly VERIFIER=/usr/local/libexec/williamos-aegis-root-handoff.mjs
readonly LOCK=/run/lock/williamos-aegis-prerequisite-handoff.lock

blocked() { /usr/bin/printf '%s\n' "{\"status\":\"BLOCKED\",\"reasonCode\":\"$1\",\"executionAuthorized\":false,\"applyAuthorized\":false}"; exit 2; }
[[ "$(/usr/bin/id -u)" == 0 ]] || blocked ROOT_REQUIRED
[[ "$(/usr/bin/uname -s)" == Linux ]] || blocked LINUX_REQUIRED
[[ -f "$VERIFIER" && ! -L "$VERIFIER" ]] || blocked EXTERNAL_ROOT_VERIFIER_UNAVAILABLE
[[ $# == 2 && "$1" == --apply && "$2" =~ ^/var/lib/williamos-fabric/remote-dev-prerequisite-handoff/authorities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$ ]] || blocked EXACT_AUTHORITY_PATH_REQUIRED

exec /usr/bin/flock --exclusive --nonblock "$LOCK" /usr/bin/systemd-run --quiet --wait --pipe --collect --service-type=exec \
  --unit=williamos-aegis-root-handoff.service --property=KillMode=control-group --property=TimeoutStopSec=30s \
  --property=RuntimeMaxSec=30min /usr/bin/node "$VERIFIER" --locked-apply "$2"
