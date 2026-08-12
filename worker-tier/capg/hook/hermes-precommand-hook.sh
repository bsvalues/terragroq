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
# NB: no `set -e` — capg intentionally exits 2 (ASK) / 3 (DENY), and `set -e` would abort the
# `OUT=$(...)` capture before the verdict is handled, dropping the block. We handle rc explicitly.
set -uo pipefail
CMD="${1:-${HERMES_COMMAND:-}}"
CAPG_ROOT="${CAPG_ROOT:-/home/pilot}"   # dir containing the `capg` package

if [ -z "$CMD" ]; then
  echo '{"decision":"ASK","reason":"no command supplied to gate"}'
  exit 2
fi

# classify; python -m capg already returns 0/2/3 for ALLOW/ASK/DENY
cd "$CAPG_ROOT"
OUT="$(python3 -m capg "$CMD")" ; RC=$?
echo "$OUT"
case "$RC" in
  0) exit 0 ;;   # ALLOW
  3) exit 3 ;;   # DENY (hard block)
  *) exit 2 ;;   # ASK / anything unexpected -> fail-closed to approval
esac
