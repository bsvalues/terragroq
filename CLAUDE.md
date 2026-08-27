# Claude Code Provider Adapter

Claude Code must first follow the repository entrypoint in [`AGENTS.md`](AGENTS.md). For product work,
[`PRODUCT_EXECUTION.md`](PRODUCT_EXECUTION.md) controls product direction, lane scope, priorities, and
completion. The historical
[`multi-agent operator playbook`](docs/governance/multi-agent-operator-playbook.md) applies only where
it does not conflict with that product contract. This adapter narrows provider behavior; it does not
grant authority or establish a competing hierarchy.

## W1 development-cockpit boundary

For W1, Claude must treat WilliamOS as the **software-development cockpit used to build TerraFusion**.
TerraFusion is the target software project, not WilliamOS's own county/operator/business interface.

The W1 application pane is a developer preview/runtime surface of the software under development. Do
not reinterpret `running TerraFusion stays interactive beside it` as permission to design parcel,
appeals, taxpayer, PACS, county-workload, or other TerraFusion business workflows as WilliamOS UI.

If the real preview is unavailable, use a neutral and explicitly labeled developer-preview/degraded
fixture. Do not use a simulated TerraFusion business-workflow screen as the WilliamOS fixture.

Do not modify TerraFusion source merely as WilliamOS acceptance scaffolding. In particular, do not add
acceptance comments or fake content to TerraFusion `README.md` or arbitrary project files to prove
editor/save behavior. Use designated scratch/test files or a disposable worktree and restore any
temporary target-repository mutation automatically.

This boundary is already decided. If Claude realizes it drifted from it, Claude must correct/revert the
wrong local work and continue. **Do not stop with `pending your confirmation` to ask William to
reconfirm this boundary.** Ask only if the next action would materially change the recorded boundary
or require another genuinely new owner decision.

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
- ask William to reconfirm an already-recorded product boundary after Claude's own self-correction;
- turn TerraFusion business/operator UX into the WilliamOS W1 product surface;
- leave WilliamOS acceptance scaffolding or fake content in the TerraFusion repository;
- invoke, retry, wrap, rename, or reuse the rejected issue #357 nested Codex adapter;
- activate the disabled WilliamOS local runtime or release dependency-blocked issue #358;
- block healthy Codex lanes merely because Claude is unavailable.

On provider unavailability, record the playbook's typed provider-unavailable state and return control
to the coordinator. On a genuine authority gap, return the exact decision required. Otherwise,
problem-solve inside scope and communicate the final verified lane outcome rather than routine
progress chatter.
