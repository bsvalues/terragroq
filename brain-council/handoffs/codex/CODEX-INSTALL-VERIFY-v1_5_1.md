# Codex Handoff: Brain Council v1.5.1 Install + Verify

## Objective

Install Brain Council v1.5.1 into WilliamOS under `brain-council/` and verify the install.

## Target Repo

`C:\Users\bsval\william-os-devops`

## Allowed

- run package installer
- run package verifier
- inspect resulting files
- report scope

## Commands

From extracted package root:

```powershell
python scripts\install_into_repo.py --target C:\Users\bsval\william-os-devops
```

From WilliamOS repo root:

```powershell
python brain-council\scripts\verify_install.py --root brain-council
```

## Blocked

- no git add
- no commit
- no push
- no PR readiness
- no merge
- no tag
- no release
- no MCP activation
- no autonomous agents
- no production/data write

## Required Output

```text
RESULT: PASS / FAIL / PARTIAL
PACKAGE_VERSION:
INSTALL_REPORT:
VERIFY_REPORT:
FILES_ADDED_OR_CHANGED:
DIFF_SCOPE_CONTAINED_TO_BRAIN_COUNCIL: YES/NO
SAFE_TO_COMMIT: NO unless owner separately approves
SAFE_TO_PUSH: NO
SAFE_TO_PR_READY: NO
SAFE_TO_MERGE: NO
SAFE_TO_RELEASE: NO
SAFE_TO_ENABLE_MCP: NO
SAFE_TO_ENABLE_AUTONOMY: NO
```
