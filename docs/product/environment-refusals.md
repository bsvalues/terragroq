# Environment refusals

The Environment is a working surface, not a rearranged operator shell. Its rendered root enforces
these refusals:

- No Project picker, navigation rail, dashboard cards, inspector, or other legacy-shell chrome.
- No Work Order, Goal, queue, authority, provider, branch, or agent-control vocabulary in the owner
  conversation. Internal execution records may support the work, but they are not the interaction
  model.
- No browser demo, login reproduction, test result, rerun, comparison, or conflict claim without a
  server-bound artifact and explicit provenance.
- No ready endpoint without admitted isolation evidence and a successful server-side liveness check.
- No client-created restoration truth. The server-restored working world is the source of truth;
  client state only retains the latest complete reply for the current interaction.
- No optimistic success. A failed Line request preserves the last authoritative world and the
  owner's unsent words.
- No embedded legacy WilliamOS route. Runnable browser surfaces must be separately admitted,
  isolated endpoints and are rendered in a sandbox without same-origin capability.
- No second universal composer. The Environment contains exactly one Line.

When evidence is absent, the surface says it is waiting or unavailable. Empty space is preferred to
invented proof.

## Activation boundary

Fresh installations receive the Environment tables from `drizzle/0000_williamos_init.sql`. Existing
installations must run `pnpm db:environment:migrate`; the idempotent command applies only
`migrations/0013-environment-world.sql` and verifies the three required tables.

The resident publisher requires a dedicated runtime identity. Provision it once on HERMES with
`WILLIAMOS_RUNTIME_USER_ID` and an absolute `WILLIAMOS_RUNTIME_DEVICE_TOKEN_FILE` by running
`pnpm db:environment:runtime-device`. The token is written to that file, never printed. The resident
operator reads the same file and also requires:

- `WILLIAMOS_ENVIRONMENT_RUNTIME_ORIGIN`: a loopback origin for the live WilliamOS API;
- `WILLIAMOS_ENVIRONMENT_PORT_RANGE`: a bounded range such as `4200-4299` for isolated previews;
- `WILLIAMOS_ENVIRONMENT_PUBLIC_URL_TEMPLATE`: a client-safe URL containing `{worldId}` and,
  optionally, `{port}`. Non-loopback URLs must be HTTPS and must terminate at the corresponding
  isolated preview through deployment-owned routing.

An Environment-bound Work Order cannot enter PR review until its required build exists, the preview
responds, endpoint and validation evidence are durably bound to the exact resource/branch/head and
payload digest, and the runtime API accepts both observations under the exact active grant. Missing
configuration is `WAITING_ENVIRONMENT`, not completion and not an owner gate.
