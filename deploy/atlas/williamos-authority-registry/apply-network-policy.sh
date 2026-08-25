#!/usr/bin/env bash
# Packet-layer allowlist for the WilliamOS authority oracle's published port.
#
# WHY NOT ufw. Docker publishes ports by DNAT in the `nat` PREROUTING chain. That traffic is
# forwarded to the container and never traverses the `INPUT` chain that `ufw` filters, so a host
# firewall configured the obvious way reports a tidy policy and blocks nothing at all. `DOCKER-USER`
# is the chain Docker guarantees is consulted before its own rules and never rewrites, and it is
# therefore the only correct place for this.
#
# WHY A DEDICATED CHAIN. Rules are installed in `WILLIAMOS-AUTHORITY` and jumped to from
# `DOCKER-USER`. Re-running flushes only our chain, so this is idempotent and cannot accumulate
# duplicates or step on another owner's DOCKER-USER rules.
#
# WHY `--ctorigdstport` AND NOT `--dport`. This was written the obvious way first and measured, and
# the obvious way blocks nothing. `nat` PREROUTING runs before `filter` FORWARD, so by the time a
# packet reaches DOCKER-USER its destination port has already been rewritten 15432 -> 5432: a
# `--dport 15432` rule sits there matching zero packets while the chain's own counter climbs. It
# reads exactly like a working firewall. `--ctorigdstport` asks conntrack what the connection was
# ORIGINALLY addressed to, which is the published port regardless of DNAT.
#
# `--ctdir ORIGINAL` is not optional either. Without it the DROP also matches the reply direction of
# an ALLOWED connection -- whose source is the container, not the allowlisted caller -- and the
# allowlist silently breaks the one caller it exists to permit.
#
# NO FAIL-OPEN. Every refusal below exits non-zero with the port left in whatever state it was
# already in. A missing or malformed caller list is a reason to stop, never a reason to allow
# everything: "we could not read the allowlist" must not become "there was nothing to enforce".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALLERS="${CALLERS_FILE:-$HERE/fabric-callers.json}"
CHAIN="WILLIAMOS-AUTHORITY"
MODE="${1:-apply}"

die() { echo "$*" >&2; exit 1; }

case "$MODE" in
  apply|check) ;;
  *) die "usage: ${BASH_SOURCE[0]##*/} [apply|check]" ;;
esac

command -v iptables >/dev/null 2>&1 || die "IPTABLES_MISSING: iptables is not on PATH; refusing rather than leaving tcp/15432 unfiltered"
command -v python3  >/dev/null 2>&1 || die "PYTHON3_MISSING: the caller list cannot be parsed; refusing rather than guessing an allowlist"
# The conntrack match is what makes this policy work at all (see above). Its absence would leave a
# chain that installs cleanly and filters nothing, so it is checked rather than assumed.
iptables -m conntrack --help >/dev/null 2>&1 || die "CONNTRACK_MATCH_UNAVAILABLE: iptables has no conntrack match, so the published port cannot be filtered after DNAT rewrites it; refusing rather than installing rules that would match nothing"
[ -f "$CALLERS" ] || die "CALLERS_FILE_UNREADABLE: $CALLERS does not exist, so the approved fabric callers cannot be resolved. Refusing rather than applying an empty or default-open policy."

# The parser is strict on purpose. A caller entry without a CIDR, or a list with no callers at all,
# is a malformed declaration -- not an instruction to open the port to everyone, and not an
# instruction to lock the control plane out silently either.
read -r PORT CIDRS <<EOF
$(python3 - "$CALLERS" <<'PY'
import ipaddress, json, sys
try:
    doc = json.load(open(sys.argv[1]))
except Exception as exc:
    sys.exit("CALLERS_FILE_INVALID: %s is not readable JSON (%s)" % (sys.argv[1], exc))
port = doc.get("publishedPort")
if not isinstance(port, int) or not (1 <= port <= 65535):
    sys.exit("CALLERS_FILE_INVALID: publishedPort is missing or not a valid port")
callers = doc.get("callers")
if not isinstance(callers, list) or not callers:
    sys.exit("CALLERS_FILE_INVALID: no callers declared; refusing to apply a policy that would "
             "either open the port to everyone or lock out every fabric caller by accident")
cidrs = []
for entry in callers:
    cidr = (entry or {}).get("cidr")
    if not cidr:
        sys.exit("CALLERS_FILE_INVALID: caller %r declares no cidr" % ((entry or {}).get("nodeId"),))
    try:
        cidrs.append(str(ipaddress.ip_network(cidr, strict=True)))
    except ValueError as exc:
        sys.exit("CALLERS_FILE_INVALID: caller %r cidr %r is not a network (%s)" % (entry.get("nodeId"), cidr, exc))
print(port, " ".join(cidrs))
PY
)
EOF

[ -n "${PORT:-}" ] && [ -n "${CIDRS:-}" ] || die "CALLERS_FILE_INVALID: the caller list produced no port/allowlist"

# The exact rule set this policy means, rendered once and used by both modes so `check` cannot
# drift from `apply`.
desired() {
  for cidr in $CIDRS; do
    echo "-A $CHAIN -s $cidr -p tcp -m conntrack --ctorigdstport $PORT --ctdir ORIGINAL -j RETURN"
  done
  echo "-A $CHAIN -p tcp -m conntrack --ctorigdstport $PORT --ctdir ORIGINAL -j DROP"
}

if [ "$MODE" = check ]; then
  iptables -S "$CHAIN" >/dev/null 2>&1 || die "POLICY_ABSENT: chain $CHAIN does not exist; tcp/$PORT is unfiltered"
  iptables -S DOCKER-USER | grep -qx -- "-A DOCKER-USER -j $CHAIN" || die "POLICY_UNREACHABLE: DOCKER-USER does not jump to $CHAIN, so the rules exist and are never consulted"
  actual="$(iptables -S "$CHAIN" | grep -v -- "-N $CHAIN")"
  if [ "$actual" != "$(desired)" ]; then
    echo "POLICY_DRIFTED: $CHAIN does not match fabric-callers.json" >&2
    echo "--- installed ---" >&2; printf '%s\n' "$actual" >&2
    echo "--- declared  ---" >&2; desired >&2
    exit 1
  fi
  echo "POLICY_OK: tcp/$PORT allowlisted to: $CIDRS (everything else dropped)"
  exit 0
fi

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
for cidr in $CIDRS; do
  iptables -A "$CHAIN" -s "$cidr" -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL -j RETURN
done
iptables -A "$CHAIN" -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL -j DROP

# Exactly one jump, and at the top of DOCKER-USER: a jump appended after another owner's blanket
# RETURN would never be reached.
while iptables -C DOCKER-USER -j "$CHAIN" 2>/dev/null; do iptables -D DOCKER-USER -j "$CHAIN"; done
iptables -I DOCKER-USER 1 -j "$CHAIN"

echo "POLICY_APPLIED: tcp/$PORT allowlisted to: $CIDRS (everything else dropped)"
iptables -S "$CHAIN"
