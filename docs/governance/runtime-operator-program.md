# WilliamOS Runtime Operator Program

Program: `PROGRAM-WILLIAMOS-RUNTIME-OPERATOR-001`

Active goal: `GOAL-RUNTIME-OPERATOR-LOCAL-FIRST-REMEDIATION-001`

## Authority

The owner authorized a bounded background operator hosted locally on the HP
OMEN. GitHub Actions is prohibited as the autonomous runtime host unless a
future owner decision names that host explicitly. GitHub may provide source,
issues, pull requests, reviews, and CI validation.

The earlier GitHub Actions control-plane design is superseded. Its workflow and
normal issue intake are removed by the remediation goal. No OpenAI credential
may be added to GitHub.

## Runtime contract

The Phase 1 runtime is the Docker Compose service in `runtime-operator`. It is
serialized, disabled by default, checkpointed, retry-bounded, secret-file
mounted, and locally killable. It accepts only the existing schema-bound R0/R1
Work Order envelope and applies the existing authority evaluator and exact-path
allowlist before any repository write.

Owner-only actions are limited to creating or rotating the two local credential
files, changing the local activation file to `enabled`, and physically
administering the OMEN. Credential values never enter GitHub or repository
evidence.

The dedicated Ubuntu host remains an inactive Phase 2 migration target. See
`docs/governance/local-runtime-operator-boundary.md`.
