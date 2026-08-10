# WilliamOS Execution Fabric AEGIS bounded contract 001

Issue: `#538`

Status: `NON_ACTIVE_CONTRACT_READY`

## Purpose

Define the exact fail-closed boundary for a future single AEGIS compute dispatch without granting
authority or adding an execution surface. The contract covers:

```text
CI_BUILD_TEST
HASH_VERIFY
COMPRESSION
```

## Boundaries

```text
NODE: aegis
IDENTITY: 1b490fe20bf3d61dc1f14e3a6e7fe38fc7de69c14face211fdd5afd0544c9c8b
CONCURRENCY: 1
CPU THREADS: <= 12
MEMORY: <= 8 GiB
RUNTIME: <= 30 minutes
OUTPUT: <= 512 MiB
WRITES: <= 5 GiB
NVME FREE RESERVE: >= 100 GiB
NETWORK: none
STORAGE: job-scoped NVMe scratch only
EXECUTION IDENTITY: dedicated non-root/no-sudo account required, not provisioned
```

All request shapes declare one `bsvalues/terragroq` commit, source-tree digest, placement-receipt
digest, exact template, bounded limits, and the exact Agent Forge permission bytes. This
process-free evaluator does not prove Git ancestry, source-tree identity, or placement freshness;
trusted `origin/main` source proof and fresh placement proof are required before any future
activation. The validator rejects executable fields, secret-like values, changed trust artifacts, symlinks,
alternate nodes, unreviewed templates, non-SHA-256 hash work, nondeterministic compression, and any
limit increase.

The operation itself is selected from an exact digest-pinned, non-active profile registry. Inputs
must use a repository-retained manifest whose exact bytes, source commit, file paths, file digests,
and declared sizes pass validation. Opaque validation-plan or file-manifest digests are not treated
as evidence.

## Required future evidence

Any later execution proof must retain exact request and reviewed-scope bytes, fresh placement,
machine identity, workspace preflight, lease and fencing history, resource observations, result and
output digests, and owned-scratch cleanup. A result without this chain is not certifiable.

## Authority posture

```text
SCHEDULER: disabled / not-granted
AEGIS AUTHORITY ENTRY: absent
EXECUTION AUTHORIZED: false
DISPATCH ALLOWED: false
AUTONOMOUS DISPATCH: false
AEGIS STORAGE/NAS/BACKUP AUTHORITY: false
REMOTE SYSTEMS MODIFIED: false
```

This is a contract-only change. It does not connect to AEGIS, create a worker, invoke a
command, acquire a lease, create a workspace, or execute a workload.

## Validation

- AEGIS contract: `13/13 PASS`;
- Execution Fabric family: `314/314 PASS`;
- full repository suite: `2,987 passed / 2 skipped / 2 unrelated Windows host failures`;
- the unrelated failures are the two existing Atlas PowerShell child-process hangs;
- production build: `PASS` (existing Better Auth and optional ESLint-plugin warnings only);
- Node syntax and `git diff --check`: `PASS`.
