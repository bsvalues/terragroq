# WO-AEH-006 - Network and Identity Remediation Design

Result: `COMPLETE / MODEL_VERIFIED / INDEPENDENT_REVIEW_PASS / DESIGN_ONLY`

Created `docs/governance/ai-evalops-harness/network-and-identity-remediation-design.md` from the
verified WO-AEH-002 inventory and WO-AEH-005 threat model. It defines intended bindings,
source/destination allowlists, distinct deploy/runtime/coordinator/backup/database/rollback
identities, exact-command sudo constraints, mutual TLS and console authentication requirements,
timed automatic rollback, rule simulations, lockout analysis, and successor-specific gates for
Hermes, Atlas, and AEGIS.

Observed facts are kept separate from design requirements. The document assumes no unobserved IP,
CIDR, interface, port, credential, account, certificate, executable path, or live enforcement.
Those values are mandatory immutable decision fields populated from fresh read-only discovery
before any R3 successor activation.

Validation performed: source and target references exist; design sections and required successor
IDs are present; only the two reserved new paths changed in this lane; textual secret scan and
trailing-whitespace scan passed; `git diff --check` passed. No live network, host, firewall,
identity, sudo, TLS, console, database, backup, service, scheduler, or worker action was performed.

Maturity before: `REMEDIATION_DESIGN_PLANNED`. Maturity after: `MODEL_VERIFIED`.
Independent reviewer `/root/packet_schema` verified observed-versus-planned
separation, every binding/identity/sudo/TLS/auth/rollback decision and simulation,
successor gates, references and non-proof posture and returned `PASS` with no
blockers. This design and its simulations
do not prove live reachability, denial, identity confinement, rollback, TLS, authentication,
service health, or production authority.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
