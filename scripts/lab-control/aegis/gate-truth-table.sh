#!/usr/bin/env bash
# Truth table for the fail-closed exit gate in backup-v1.sh.
#
# Extracts the gate's own logic from the deployed script rather than restating it, so this cannot
# drift into testing a copy that no longer matches what runs at 04:30. A full backup takes ~15
# minutes; the gate is the part that decides truth, and it deserves per-case coverage.
set -uo pipefail
SRC=/home/bs/backup-v1.sh

# The gate is everything from FAIL_REASONS="" to the exit, minus the two echo/exit lines so the
# harness can inspect the verdict instead of terminating.
# Take only the reason-accumulating half: from FAIL_REASONS="" up to, but not including, the branch
# that reports and exits. Filtering by "lines starting with echo/exit" is not enough -- those lines
# are indented inside the branch, so an earlier version of this harness eval'd `exit 1` and killed
# itself on the first case.
GATE=$(sed -n '/^FAIL_REASONS=""/,/^if \[ -n "\$FAIL_REASONS" \]/p' "$SRC" | sed '$d')

check() {
  local label="$1" expect="$2"
  PG_STATUS="$3"; WM_STATUS="$4"; FG_STATUS="$5"; H_STATUS="$6"; SEC_OK="$7"; PRI_CJ_SHA="$8"; SEC_CJ_SHA="$9"
  eval "$GATE"
  local got; if [ -n "$FAIL_REASONS" ]; then got=FAIL; else got=PASS; fi
  local mark; if [ "$got" = "$expect" ]; then mark="ok  "; else mark="BAD "; fi
  printf '%s %-46s expect=%-4s got=%-4s%s\n' "$mark" "$label" "$expect" "$got" "${FAIL_REASONS:+ ->$FAIL_REASONS}"
  [ "$got" = "$expect" ]
}

RV=RESTORE_VERIFIED
fails=0
check "all sources restore-verified"            PASS $RV $RV $RV $RV yes aaa aaa || fails=$((fails+1))
check "williamos dump failed"                   FAIL $RV FAILED $RV $RV yes aaa aaa || fails=$((fails+1))
check "hermes unreachable"                      FAIL $RV $RV $RV UNAVAILABLE yes aaa aaa || fails=$((fails+1))
check "secondary copy mismatch"                 FAIL $RV $RV $RV $RV no  aaa aaa || fails=$((fails+1))
check "crown-jewel set hash mismatch"           FAIL $RV $RV $RV $RV yes aaa bbb || fails=$((fails+1))
# The finding from sovereign review: bytes present, restore never exercised. The first version of the
# gate returned PASS here.
check "williamos hash-only, restore not proven" FAIL $RV HASH_VERIFIED $RV $RV yes aaa aaa || fails=$((fails+1))
check "tf-postgres hash-only, restore skipped"  FAIL HASH_VERIFIED $RV $RV $RV yes aaa aaa || fails=$((fails+1))
check "williamos restore only partial"          FAIL $RV RESTORE_PARTIAL $RV $RV yes aaa aaa || fails=$((fails+1))
# Non-database sources legitimately report COPIED when their deeper proof does not apply; that must
# not fail the run, or the gate becomes noise everyone routes around.
check "forge copied but not restore-verified"   PASS $RV $RV COPIED $RV yes aaa aaa || fails=$((fails+1))

echo
if [ "$fails" -eq 0 ]; then echo "GATE_TRUTH_TABLE: ALL PASS"; else echo "GATE_TRUTH_TABLE: $fails CASE(S) WRONG"; fi
exit $fails
