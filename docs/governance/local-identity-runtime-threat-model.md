# Local Identity Runtime Threat Model

## Assets and boundaries

Assets are the Windows keyring identities, repository integrity, activation
intent, runtime checkpoints, audit evidence, and the owner account. Trust
boundaries exist at issue/PR text, Codex output, Git patches, dependency
scripts, Docker validation, GitHub APIs, and the Windows process boundary.

## Controls

| Threat | Prevention | Detection | Response and recovery | Residual |
| --- | --- | --- | --- | --- |
| Credential theft or plaintext fallback | keyring-only adapters; no env/raw files/cache copies | typed auth walls | disable, logout/revoke, owner re-login | medium |
| Prompt injection or malicious PR | issue text untrusted; schema/path/risk policy | patch and review gates | block WO and preserve sanitized evidence | medium |
| Dependency script compromise | locked install; Docker validation without identity | validation/audit failure | disable, discard workspace, dependency review | medium |
| Path traversal or patch exfiltration | exact repository/path allowlists | staged-path and secret scans | reject patch and block lease | low |
| Poisoned tests | fixed validation plus independent PR checks/review | divergent local/CI evidence | no merge; owner decision for broad repair | medium |
| Stale lease or duplicate supervisor | atomic host lock and checkpoint lease design | PID/start-time and lease expiry | recover stale state; second process exits | low |
| Hostile workflow change | Actions cannot host operator; workflow paths blocked | diff/review policy | reject and record authority wall | low |
| Local host compromise | non-elevated user; kill switch; no raw credentials | identity/ACL/process checks | disable, revoke identities, rebuild host | medium |

No unmitigated critical or high residual risk is accepted for the pilot.
Activation remains disabled until later gates prove the controls.
