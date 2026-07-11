#!/bin/sh
set -u

audit() {
  node /opt/operator/audit.mjs "$1" "${2:-}"
}

if [ "$(cat /run/secrets/activation 2>/dev/null || true)" != "enabled" ]; then
  audit disabled "Local owner activation switch is not enabled"
  exec sleep infinity
fi

IFS= read -r OPENAI_API_KEY < /run/secrets/openai_api_key
IFS= read -r GITHUB_TOKEN < /run/secrets/github_token
export OPENAI_API_KEY GITHUB_TOKEN
unset ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
mkdir -p "$HOME" "$NPM_CONFIG_CACHE"

retry=5
while :; do
  if /opt/operator/local-cycle.sh; then
    audit cycle_complete "Serialized cycle completed"
    retry=5
    sleep "${WILLIAMOS_POLL_SECONDS:-60}"
  else
    audit cycle_failed "Retrying after ${retry} seconds"
    sleep "$retry"
    retry=$((retry * 2))
    [ "$retry" -le "${WILLIAMOS_MAX_RETRY_SECONDS:-300}" ] || retry="${WILLIAMOS_MAX_RETRY_SECONDS:-300}"
  fi
done
