#!/bin/sh
set -u

audit() {
  node /opt/operator/audit.mjs "$1" "${2:-}"
}

activation="$(cat /run/secrets/activation 2>/dev/null || true)"
audit superseded_identity_host "${WILLIAMOS_RUNTIME_HOST_STATUS:-SUPERSEDED_IDENTITY_HOST / DISABLED}; activation input ignored: $activation"
exec sleep infinity
