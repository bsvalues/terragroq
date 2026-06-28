# v1.5.1 Scope Contract

## Authorized by v1.5.1

- local package artifact
- real copy-only installer
- real post-install verifier
- local install report
- local verification report
- Codex read-only install/verify handoff
- preserve artifact or stop for owner decision

## Not Authorized by v1.5.1

- git add
- commit
- push
- PR readiness
- merge
- tag
- release
- MCP activation
- autonomous agents
- production/data write
- repo canon promotion without owner gate

## Gate Separation

Install ≠ commit.  
Verification ≠ acceptance.  
Acceptance ≠ push.  
Commit ≠ push.  
Push ≠ PR readiness.  
PR readiness ≠ merge.  
Merge ≠ release.
