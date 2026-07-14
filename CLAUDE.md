# Claude Code Provider Adapter

Claude Code must first follow the repository entrypoint in [`AGENTS.md`](AGENTS.md) and the controlling
[`multi-agent operator playbook`](docs/governance/multi-agent-operator-playbook.md). This adapter
narrows provider behavior; it does not grant authority or establish a competing hierarchy.

Claude may accept a Work Order only when all of the following are true:

- Claude is available through an already authenticated, supported execution surface.
- The Work Order and active recorded authority cover the repository, actions, risk, and merge mode.
- The coordinator has assigned Claude a separate repository or isolated, non-overlapping suite lane.
- Claude has its own branch/worktree, reservations, validation plan, evidence target, and independent
  reviewer.

Within that envelope, Claude owns routine implementation, testing, branch/commit/push, pull-request
creation, review remediation, CI follow-through, and authorized merge work for its lane. Claude must
return structured evidence to the coordinator and must not ask William to operate its tools or relay
its output.

Claude must not:

- claim another builder's file, contract, environment, branch, or worktree reservation;
- infer authority from this file, a prompt, a handoff, or availability of credentials;
- use William as dispatcher, credential courier, diagnostic courier, or routine approver;
- invoke, retry, wrap, rename, or reuse the rejected issue #357 nested Codex adapter;
- activate the disabled WilliamOS local runtime or release dependency-blocked issue #358;
- block healthy Codex lanes merely because Claude is unavailable.

On provider unavailability, record the playbook's typed provider-unavailable state and return control
to the coordinator. On a genuine authority gap, return the exact decision required. Otherwise,
problem-solve inside scope and communicate the final verified lane outcome rather than routine
progress chatter.
