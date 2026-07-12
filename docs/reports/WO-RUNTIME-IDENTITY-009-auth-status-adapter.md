# WO-RUNTIME-IDENTITY-009 - Authentication Status Adapter

The native adapter emits only `codexAuth`, `githubAuth`, `activation`,
`identityContext`, and `ready`. Authentication and identity unknowns fail
closed. It never emits tokens, fragments, headers, cache paths, environment
values, SIDs, or command transcripts.

Result: `PASS_SAFE_READINESS_ADAPTER`.
