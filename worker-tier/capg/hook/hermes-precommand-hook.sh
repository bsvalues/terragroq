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

if [ -z "$CMD" ]; then
  echo '{"decision":"ASK","reason":"no command supplied to gate"}'
  exit 2
fi

# Keep errexit for setup while capturing CAPG's expected ASK/DENY statuses explicitly. A missing
# or broken classifier is normalized to structured ASK instead of escaping as a generic hook error.
if OUT="$(PYTHONPATH="$CAPG_ROOT${PYTHONPATH:+:$PYTHONPATH}" python3 -m capg "$CMD")"; then
  RC=0
else
  RC=$?
fi
case "$RC" in
  0) echo "$OUT"; exit 0 ;;   # ALLOW
  2) echo "$OUT"; exit 2 ;;   # ASK
  3) echo "$OUT"; exit 3 ;;   # DENY (hard block)
  *) echo '{"decision":"ASK","reason":"CAPG classifier failed; command requires approval"}'
     exit 2 ;;                 # unexpected -> fail-closed to approval
esac
