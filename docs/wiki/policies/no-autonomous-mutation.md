# No Autonomous Mutation Policy

WilliamOS must not mutate systems without explicit authority.

## Policy

- No hidden writes.
- No background mutation.
- No worker activation.
- No production writes.
- No repo writes outside scoped Work Orders.
- No DB/schema changes without authority.
- No env/package/cloud settings changes without authority.
- No command execution from UI without authority.

## Safe Default

If authority is unclear, stop and return a blocked decision or stop-condition report.

## Owner Authority

The Primary remains the approving authority. WilliamOS, Codex, Academy, Wiki, Evidence, Memory, Trace Ledger, Brain Council, Hermes, and agents do not self-authorize.
