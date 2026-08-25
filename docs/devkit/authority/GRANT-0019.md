# Authority Grant GRANT-0019 — A3_WRITE_SHARED
- **artifact_id:** GRANT-0019
- **artifact_type:** authority
- **sha256:** 8750ac92d9ea2d925ad49233eaa5d484c4c93d38c76e627f337a61731c007caa
- **created_at:** 2026-08-25T10:05:06.697Z
## Granted to

claude

## Scope

#995

## Allowed actions

node.stamp-identity

## Blocked actions

production mutation
TerraFusion
Property Workbench
TerraPilot
county/PACS
protected data
paid overage
destructive action
secret inspection
authority expansion
issue #357
delete
revoke
merge
release
spend

## Reason

Owner decision 2026-08-25: authorise exactly node.stamp-identity under #995 for the canonical node:hermes-node, and nothing wider. Recorded through app/actions/authority.ts createAuthorityGrantWithResult; no SQL was written by hand. TARGET IS NOT ENFORCED BY THIS ROW: authority_grant has no target column and grantCovers checks only level and action, so the node restriction above is a statement of intent. What actually confines the mutation to one machine is the route -- it takes the endpoint from the transport registry rather than from the request, and refuses any object absent from the canonical graph. CONT-EXPV2-GRANT-HAS-NO-TARGET-PREDICATE. Bounded to 2 hours and revoked immediately after the terminal proof.

## Expires

2026-08-25T12:05:06.566Z
