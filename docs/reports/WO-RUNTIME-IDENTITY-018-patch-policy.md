# WO-RUNTIME-IDENTITY-018 - Patch Envelope and Path Policy

The staged-path policy rejects rooted/traversal paths, escapes, reparse points,
binary payloads, workflows, auth/environment/package files, migrations,
deployments, and other protected paths before publication. Violations are
atomic walls, never partial writes.

Result: `PASS_PATCH_POLICY`.
