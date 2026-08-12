#!/usr/bin/env bash
# CAPG pre-command hook for Hermes (or any runner that shells out).
# Wire this as Hermes' pre-command / pre-tool shell hook so EVERY command Hermes proposes is
# gated by our deterministic policy BEFORE it runs — overriding Hermes' own (untrustworthy)
# approval classifier for the exfil/lateral cases it misses.
#
# Install (inside the caged child, once CAPG is present at /home/pilot/capg):
#   hermes hooks add pre-command /home/pilot/capg/hook/hermes-precommand-hook.sh
# (exact subcommand per `hermes hooks --help`; the contract below is what the hook guarantees.)
#
# Contract: the command to gate arrives as $1 (or $HERMES_COMMAND). Exit codes:
#   0  ALLOW -> Hermes proceeds
#   2  ASK   -> require explicit human approval (do NOT auto-run)
#   3  DENY  -> block; Hermes must not run it
set -euo pipefail
CMD="${1:-${HERMES_COMMAND:-}}"
CAPG_ROOT="${CAPG_ROOT:-/home/pilot}"   # dir containing the `capg` package

fail_closed() {
  echo '{"decision":"ASK","reason":"CAPG classifier failed; command requires approval"}'
  exit 2
}

if [ -z "$CMD" ]; then
  echo '{"decision":"ASK","reason":"no command supplied to gate"}'
  exit 2
fi

# Resolve an absolute, existing package root before invoking Python. Running from that root with
# safe-path mode and a replaced PYTHONPATH prevents a caller-controlled cwd package from shadowing
# the trusted CAPG implementation.
case "$CAPG_ROOT" in
  /*|[A-Za-z]:/*) ;;
  *) fail_closed ;;
esac
if ! TRUSTED_ROOT="$(cd -- "$CAPG_ROOT" 2>/dev/null && pwd -P)"; then
  fail_closed
fi
for REQUIRED in __init__.py __main__.py gate.py rules.py; do
  if [ ! -f "$TRUSTED_ROOT/capg/$REQUIRED" ]; then
    fail_closed
  fi
done

# Keep errexit for setup while capturing CAPG's expected ASK/DENY statuses explicitly.
if OUT="$(cd -- "$TRUSTED_ROOT" &&
          PYTHONPATH="$TRUSTED_ROOT" PYTHONSAFEPATH=1 python3 -P -m capg "$CMD")"; then
  RC=0
else
  RC=$?
fi
case "$RC" in
  0) EXPECTED=ALLOW ;;
  2) EXPECTED=ASK ;;
  3) EXPECTED=DENY ;;
  *) fail_closed ;;
esac

# A broken classifier that exits with a reserved status but emits empty/malformed/mismatched output
# is still a failure, not a valid gate verdict.
if ! printf '%s' "$OUT" |
     PYTHONPATH= PYTHONSAFEPATH=1 python3 -P -c \
       'import json, sys; data = json.load(sys.stdin); raise SystemExit(data.get("decision") != sys.argv[1])' \
       "$EXPECTED"; then
  fail_closed
fi
echo "$OUT"
exit "$RC"
