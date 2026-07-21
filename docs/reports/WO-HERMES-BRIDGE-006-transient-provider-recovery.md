# WO-HERMES-BRIDGE-006 - Transient Native Provider Recovery

## Result

The interactive supervisor reclaimed the preserved Home outcome, but the Codex delivery turn
classified the first pre-process `CreateProcessAsUserW` error 5 as terminal. A direct App Server
probe in the same interactive identity subsequently launched native Node successfully on retry.
The failure was therefore transient provider availability, not an authority or product wall.

## Correction

- Require up to three current-dispatch retries when a native command fails before process start.
- Return `RETRYABLE_PROVIDER_WALL`, abandon the lease immediately, and preserve the durable thread
  and owned worktree when all three attempts fail.
- Bound cross-dispatch retries to three durable attempts, then settle the affected outcome as
  `PROVIDER_UNAVAILABLE` so later eligible outcomes cannot be starved.
- Never terminalize the persisted owner outcome for native process or provider availability.
- Recover the one historical false terminal only when PostgreSQL evidence and the durable state
  independently match its exact outcome, fencing token, released lease, checkpoint, and reason.
- Make database recovery idempotent so an interrupted cross-store recovery can be safely retried
  while activation remains disabled.

## Proof Boundary

This remediation does not weaken the repository, reservation, review, merge, owner-touch, or blocked
scope gates. It does not reuse issue #357. Activation remains disabled until the reviewed remediation
is merged. Certification still requires the preserved ordinary-language Home outcome to complete its
tests, review, remediation, merge, merged-main verification, and outcome closure with zero owner
operational touches.
