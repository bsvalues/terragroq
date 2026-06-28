# Brain Council Superbrain Package v1.5.1

This is a hotfix of v1.5.

## What Was Fixed

v1.5 incorrectly shipped placeholder scripts:

- `scripts/install_into_repo.py`
- `scripts/verify_install.py`

v1.5.1 replaces them with:

- a real copy-only installer
- a real post-install verifier
- a verification report writer

## Install into WilliamOS

From the extracted package root:

```powershell
python scripts\install_into_repo.py --target C:\Users\bsval\william-os-devops
```

Then from the WilliamOS repo root:

```powershell
python brain-council\scripts\verify_install.py --root brain-council
```

## Still Not Authorized

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

Install is copy-only. Verification is evidence only.
