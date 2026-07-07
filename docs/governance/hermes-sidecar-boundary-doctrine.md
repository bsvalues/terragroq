# Hermes Sidecar Boundary Doctrine

Hermes is a governed WilliamOS sidecar concept. It is not active, autonomous, or trusted to act by default.

Hermes exists to describe a possible future worker boundary: a sidecar may receive a bounded Worker Packet, operate only inside an explicit Work Order, return evidence, and stop when scope, validation, authority, or safety fails.

## Boundary

- Hermes is disabled by default.
- Hermes is a governed sidecar, not an autonomous agent.
- Hermes cannot act without Work Order authority.
- Hermes cannot bypass Owner authority.
- Hermes cannot bypass Evidence.
- Hermes cannot bypass Agent Forge skill governance.
- Hermes cannot execute commands, tools, MCP, workers, or sidecar processes in this lane.
- Hermes cannot create goals, approve its own activation, expand permissions, mutate production, change auth, change DB/schema/env/package/Vercel settings, access secrets, or bypass quarantine.

## Allowed Future States

- `DISABLED`: no runtime, worker, MCP, queue, scheduler, or sidecar process exists.
- `PROPOSED`: a Work Order may describe a future Worker Packet or activation review.
- `BLOCKED`: a safety, validation, evidence, or authority gap prevents progress.
- `AUTHORIZED`: the Owner has explicitly approved a bounded future packet.
- `REVOKED`: prior authority is withdrawn or expires.

## Hard Blocked States

- `AUTONOMOUS`
- `ALWAYS_ON`
- `UNREVIEWED`
- `UNSANDBOXED`
- `UNLOGGED`

Those states are incompatible with WilliamOS authority doctrine. A future Hermes lane must stay bounded, evidenced, reversible, and owner-authorized.

## Relationship To WilliamOS

Brain Council may recommend Hermes-related work, but it cannot activate Hermes. Agent Forge may prepare and review skills, but it cannot execute them. Work Orders define allowed action. Evidence proves reality. Memory preserves context without authorizing action. Trace records future reasoning and failures. Academy teaches safe use. Wiki records durable doctrine. The Primary remains authority.

## This Lane Does Not Authorize

- Hermes activation
- MCP activation
- worker runtime
- background workers
- scheduler or service creation
- command runners
- runtime control planes
- tool execution
- dynamic skill loading
- executable skills
- production writes
- DB/schema/data mutation
- env/package/Vercel/auth changes
- memory write behavior
- dynamic ingestion, vector stores, or embeddings
- autonomy

