# Work Order Playbook

This playbook records the reusable WilliamOS operating model.

## Flow

1. The Primary authorizes `/goal`.
2. The Primary authorizes `/loop`.
3. Codex reconciles `origin/main`.
4. Codex runs listed Work Orders sequentially.
5. Codex validates meaningful slices.
6. Codex opens and merges PRs when authorized and green.
7. Codex returns one final completion report or a stop-condition report.

## Owner Is Not Courier

Codex must not ask what comes next when the next Work Order is already listed and no stop condition exists.

## Stop

Stop only for validation failure, scope conflict, required owner decision, destructive action, secrets, DB/schema/env/package/cloud/runtime/autonomy risk, or merge conflict requiring semantic owner decision.
