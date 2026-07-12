# WO-RUNTIME-IDENTITY-006 - GitHub Browser Login Contract

Implementation state: `PASS_READY_BROWSER_KEYRING_ACCOUNT_bsvalues`.

- Native GitHub CLI is pinned to `2.89.0`.
- Authentication must use `gh auth login --hostname github.com --git-protocol https`.
- The expected principal is exactly `bsvalues`.
- Environment tokens and plaintext `oauth_token` configuration produce typed
  walls before repository access.
- The adapter invokes only `gh auth status --hostname github.com`; it never
  calls `gh auth token` or reports raw status output.
- Readiness evidence is reduced to an owner-login requirement or the expected
  browser/keyring account classification.

The sanitized adapter verified the expected `bsvalues` browser/keyring account
using native GitHub CLI `2.89.0`. Runtime activation remained disabled.
