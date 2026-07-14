# WO-RUNTIME-KERNEL-001 - Operational Kernel

## Classification

Result: `IMPLEMENTED / BEHAVIORAL_ACCEPTANCE_PASS / LIVE_PROOF_PENDING`

The local native supervisor now schedules one integrated operational kernel
instead of overwriting its checkpoint with an idle `READY` record. Runtime
activation remains disabled and no live Work Order has been leased by this
change.

## Integrated Lifecycle

The kernel:

- reads GitHub issue queue state and independently binds each Work Order to the
  reviewed native authority registry;
- verifies repository, identity, activation, base SHA, dependencies, R0/R1
  risk, validation gates, budgets, and exact allowed paths;
- reconciles durable lifecycle checkpoints before taking the next action;
- invokes Codex through the keyring-backed native adapter in a read-only
  sandbox and applies only its schema-bound patch;
- inspects staged, unstaged, untracked, binary, symlink, submodule,
  secret-like, file-count, byte-count, and exact-path Git state;
- runs only the fixed declared validation commands;
- publishes an idempotent runtime branch and PR, monitors checks and review
  threads, performs bounded remediation, and rechecks merge gates;
- verifies the merge commit on `origin/main`, records completion, and resolves
  the next dependency-cleared Work Order;
- stores recoverable Codex/GitHub transport failures as bounded backoff state
  without escalating routine connectivity to the Owner.

## Behavioral Acceptance

`tests/runtime-operator-operational-kernel.test.ts` executes separate process
cycles against one durable state root. It proves initial lease through PR,
restart into review remediation, revalidation and republish, immediate
pre-merge gate recheck, verified merge, completion evidence, and automatic next
selection. Focused native-adapter coverage uses a real temporary Git repository
to prove actual filesystem policy rather than source-string claims.

## Remaining Gate

WilliamOS is not yet declared operational. The required live proof remains:
one reviewed queued R0 pilot must independently reach `COMPLETED` on merged
`main` and select the next Work Order while William performs no routine shell,
restart, relay, or implementation action. That proof requires the explicit
owner-controlled activation gate and remains pending.
