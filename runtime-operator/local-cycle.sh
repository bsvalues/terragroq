#!/bin/sh
set -eu

repo=/workspace/repo
request=/workspace/runtime-request
result=/workspace/runtime-result

if [ ! -d "$repo/.git" ]; then
  gh repo clone "$GITHUB_REPOSITORY" "$repo"
fi
cd "$repo"
git fetch --prune origin
git switch main
git reset --hard origin/main
rm -rf "$request" "$result"
mkdir -p "$request" "$result"
rm -f runtime-request runtime-result
ln -s "$request" runtime-request
ln -s "$result" runtime-result

export GITHUB_RUN_ID="local-$(date -u +%Y%m%d%H%M%S)"
export GITHUB_RUN_ATTEMPT=1
export GITHUB_OUTPUT=/tmp/lease-output
: > "$GITHUB_OUTPUT"
node /opt/operator/scripts/runtime-operator/monitor.mjs
node /opt/operator/scripts/runtime-operator/recover.mjs
node /opt/operator/scripts/runtime-operator/lease.mjs

leased="$(sed -n 's/^leased=//p' "$GITHUB_OUTPUT" | tail -1)"
[ "$leased" = true ] || exit 0
issue="$(sed -n 's/^issue_number=//p' "$GITHUB_OUTPUT" | tail -1)"
lease="$(sed -n 's/^lease_id=//p' "$GITHUB_OUTPUT" | tail -1)"
work_order="$(sed -n 's/^work_order_id=//p' "$GITHUB_OUTPUT" | tail -1)"
base="$(sed -n 's/^base_ref=//p' "$GITHUB_OUTPUT" | tail -1)"
remediation="$(sed -n 's/^remediation_pr=//p' "$GITHUB_OUTPUT" | tail -1)"

git switch -C "$base" "origin/$base"
codex exec --sandbox read-only --output-schema /opt/operator/schema/codex-output.schema.json \
  --output-last-message "$result/result.json" - < "$request/prompt.md"
node /opt/operator/scripts/runtime-operator/prepare-result.mjs
kind="$(node -e "console.log(require('$result/parsed.json').result)")"

checkpoint() {
  ISSUE_NUMBER="$issue" LEASE_ID="$lease" CHECKPOINT_STATE="$1" CHECKPOINT_DETAIL="$2" \
    node /opt/operator/scripts/runtime-operator/checkpoint.mjs
}

if [ "$kind" = AUTHORITY_WALL ]; then checkpoint BLOCKED "Codex returned an authority wall."; exit 0; fi
if [ "$kind" = NO_CHANGE ]; then checkpoint COMPLETED "Codex confirmed no repository change was required."; exit 0; fi

node /opt/operator/scripts/runtime-operator/scan-secrets.mjs "$result/result.json"
git apply --index --whitespace=error-all "$result/change.patch"
node /opt/operator/scripts/runtime-operator/verify-diff.mjs
git diff --cached --name-only -z | node /opt/operator/scripts/runtime-operator/scan-secrets.mjs --nul-stdin
npm ci
git diff --cached --check
npm run lint
npm test -- --run
NEXT_PRIVATE_BUILD_WORKER=0 NEXT_TELEMETRY_DISABLED=1 npm run build

git commit -m "runtime(operator): complete $work_order"
if [ -n "$remediation" ]; then
  branch="$base"
else
  branch="runtime/$(printf '%s' "$work_order" | tr '[:upper:]' '[:lower:]')-issue-$issue"
  git switch -c "$branch"
fi
git push -u origin "HEAD:$branch"
if [ -z "$remediation" ]; then
  gh pr create --base main --head "$branch" --title "runtime(operator): $work_order" \
    --body "Bounded local runtime Work Order. Closes #$issue. Merge remains gated by checks, reviews, and the local monitor."
fi
checkpoint PR_OPEN "Local operator published the bounded change for review."
