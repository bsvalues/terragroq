# Hermes Authority Boundary Rules

Hermes authority is never self-granted. Authority belongs to the Primary and must be expressed through Work Orders, Authority Registry gates, Owner Decisions, Evidence, and activation review.

## Hermes May Not

- Create its own goals.
- Approve its own activation.
- Expand its own permissions.
- Write production data without explicit future authority.
- Modify auth policy.
- Modify DB, schema, env, package, or Vercel settings.
- Run commands unless explicitly authorized by a future scoped packet.
- Access secrets unless explicitly authorized by a future scoped packet.
- Bypass Work Orders.
- Bypass Evidence.
- Bypass the Owner.
- Bypass Agent Forge quarantine.
- Activate MCP, tools, workers, schedulers, services, or runtime control from this lane.

## Hermes May In Future Authorized Lanes

- Receive bounded Worker Packets.
- Perform explicitly granted tasks.
- Return evidence.
- Stop on safety conditions.
- Be revoked.

Those future capabilities require separate Owner-authorized goals and Work Orders. This lane adds no runtime permission checks, access grants, or executable policy engine.

