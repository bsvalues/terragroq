#!/usr/bin/env bash
# IF-02 link probe: measure one FabricLink from this host (HERMES) to a target node.
# Latency from ICMP (p50/p95 over a short sample); usable bandwidth from a timed SCP transfer of a
# bounded payload -- the same transport a context/model transfer would use. A configured Ethernet
# speed is inventory; this measures what the link actually carries. Emits one FabricLink JSON object.
set -euo pipefail

target_alias="${1:?usage: measure-fabric-link.sh <ssh-alias> <fromNodeId> <toNodeId> [trustClass]}"
from_node="${2:?}"
to_node="${3:?}"
trust_class="${4:-lab}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- latency sample (16 pings) ---
# Resolve the ping target from the SSH config (the alias may not be a resolvable hostname).
ping_host="$target_alias"
if ! ping -n 1 -w 1000 "$ping_host" >/dev/null 2>&1; then
  cfg_host="$(awk -v h="$target_alias" 'BEGIN{IGNORECASE=1} $1=="Host" && tolower($2)==tolower(h){f=1} f && tolower($1)=="hostname"{print $2; exit}' "$HOME/.ssh/config" 2>/dev/null || true)"
  [[ -n "$cfg_host" ]] && ping_host="$cfg_host"
fi
declare -a rtts=()
while read -r ms; do
  [[ -n "$ms" ]] && rtts+=("$ms")
done < <(ping -n 16 -w 1000 "$ping_host" 2>/dev/null | grep -oiE 'time[=<][0-9.]+ms|time[=<][0-9.]+' | grep -oE '[0-9.]+' || true)

p50=""; p95=""
if (( ${#rtts[@]} > 0 )); then
  IFS=$'\n' sorted=($(printf '%s\n' "${rtts[@]}" | sort -n)); unset IFS
  n=${#sorted[@]}
  p50="${sorted[$(( (n-1)/2 ))]}"
  p95="${sorted[$(( (95*n + 99)/100 - 1 ))]}"
fi

# --- bandwidth: timed SCP of a 64MB payload, generated locally, sent to the node's /dev/null ---
payload="$tmp/payload.bin"
head -c 67108864 /dev/urandom > "$payload" 2>/dev/null || dd if=/dev/urandom of="$payload" bs=1M count=64 2>/dev/null
bytes=$(stat -c %s "$payload" 2>/dev/null || stat -f %z "$payload")
start=$(date +%s.%N)
scp_status=0
scp -o BatchMode=yes -o ConnectTimeout=10 -q "$payload" "$target_alias:/dev/null" 2>/dev/null || scp_status=$?
end=$(date +%s.%N)
elapsed=$(awk -v a="$start" -v b="$end" 'BEGIN{d=b-a; if(d<=0)d=0.0001; print d}')
bw=""
if (( scp_status == 0 )) && command -v awk >/dev/null; then
  bw=$(awk -v by="$bytes" -v e="$elapsed" 'BEGIN{printf "%d", (e>0)? by/e : 0}')
fi

observed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$from_node" "$to_node" "$trust_class" "$p50" "$p95" "$bw" "$observed" <<'PY'
import json, sys, hashlib
from_node, to_node, trust, p50, p95, bw, observed = sys.argv[1:8]
link = {
    "id": f"{from_node}..{to_node}",
    "fromNodeId": from_node,
    "toNodeId": to_node,
    "transportClass": "ethernet-lan-ssh",
    "trustClass": trust,
    "observedAt": observed,
    "freshnessState": "LIVE",
}
if p50:
    link["latencyMsP50"] = float(p50)
if p95:
    link["latencyMsP95"] = float(p95)
if bw and int(bw) > 0:
    link["measuredBandwidthBytesPerSecond"] = int(bw)
if not p50 and not bw:
    link["freshnessState"] = "FAILED"
link["evidenceRef"] = "scripts/execution-fabric/measure-fabric-link.sh"
print(json.dumps(link))
PY
