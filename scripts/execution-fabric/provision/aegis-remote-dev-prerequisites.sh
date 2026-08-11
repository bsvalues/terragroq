#!/usr/bin/env bash
set -u -o pipefail

readonly PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
readonly PLANNER="$PACKAGE_ROOT/scripts/execution-fabric/provision/aegis-remote-dev-prerequisites.mjs"

blocked() {
  /usr/bin/printf '%s\n' "{\"status\":\"BLOCKED\",\"reasonCode\":\"$1\",\"detail\":\"$2\",\"executionAuthorized\":false,\"applyAuthorized\":false}"
  return 2
}

if [[ "$(/usr/bin/id -u)" != "0" ]]; then
  blocked "ROOT_PREFLIGHT_REQUIRED" "run the read-only preflight as root on the reviewed AEGIS machine"
  exit $?
fi
if [[ "$(/usr/bin/uname -s)" != "Linux" ]]; then
  blocked "LINUX_PREFLIGHT_REQUIRED" "the package is AEGIS Linux-only"
  exit $?
fi
if [[ ! -x /usr/bin/node ]]; then
  blocked "PINNED_NODE_MISSING" "the read-only package planner requires the reviewed /usr/bin/node toolchain prerequisite"
  exit $?
fi

case "${1:---preflight}" in
  --preflight)
    exec /usr/bin/node "$PLANNER" inspect
    ;;
  --dry-run)
    [[ $# == 2 && -f "$2" ]] || { blocked "OBSERVATION_REQUIRED" "provide one root-owned read-only observation JSON file"; exit $?; }
    exec /usr/bin/node "$PLANNER" dry-run "$2"
    ;;
  --apply)
    blocked "LIVE_APPLY_OWNER_HANDOFF_REQUIRED" "this reviewed package does not mutate AEGIS; a separate exact owner authority and live-apply handoff are required"
    exit $?
    ;;
  --rollback)
    blocked "ROLLBACK_OWNER_HANDOFF_REQUIRED" "rollback is journal-bound, evidence-preserving, and requires a separate exact owner authority"
    exit $?
    ;;
  *)
    blocked "USAGE_INVALID" "use --preflight, --dry-run OBSERVATION.json, --apply, or --rollback"
    exit $?
    ;;
esac
