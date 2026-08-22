# WO-AEH-049 - Setup, Topology, and Package Metadata Reconciliation

Result: `COMPLETE / DOCUMENTATION_RECONCILED / INDEPENDENT_REVIEW_PASS`

Reconciled operator-facing setup and support truth across WilliamOS and HermesLab:

- exact pnpm/Corepack and frozen-install command;
- complete environment-variable names without values;
- integration-managed application schema versus the validation-only AEH migration workflow;
- primary, optional/legacy, bounded, and uncertified product surfaces;
- OMEN, Hermes, Atlas, and AEGIS roles;
- observed Open WebUI/Portainer state;
- explicit Hermes PostgreSQL/Redis running/non-authoritative drift; and
- AEGIS's narrow, expiring evidence and non-scheduler role.

Owned files:

- `terragroq:README.md`
- `terragroq:docs/CONTRIBUTING.md`
- `HermesLab:README.md`
- `HermesLab:SERVICE-MAP.md`
- this report

Package identity and exact dependency/provenance metadata are owned by
WO-AEH-010 and referenced rather than concurrently edited here.

Validation: documented paths resolve; environment names match `.env.example`;
no environment values, credentials, or protected payloads were recorded;
service/topology claims reconcile to WO-AEH-002 evidence; `git diff --check`
passes. No service, host, network, database, container, or runtime mutation was
performed.

Rollback restores only these documentation edits and removes this uncommitted
report. It does not alter observed services or any foreign dirty state.

Maturity remains `MODEL_VERIFIED`; documentation reconciliation does not prove
runtime readiness, restore safety, scheduler capability, or production authority.

Independent reviewer `/root/packet_assurance` verified engines-compatible Node
guidance, actual local-setup default semantics, commands, environment names,
links, support/topology truth, WO-AEH-002 drift/staleness qualifiers, WO-AEH-010
ownership separation, rollback and secret posture, and returned `PASS` with no
blocking findings.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
