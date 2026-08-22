# WO-AEH-009 - Database Migration and Rollback Workflow

Result: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS / DISPOSABLE_ONLY`

Implemented a checked-in AEH migration manifest, expand/contract SQL fixtures, inverse contract
fixture, Drizzle generation metadata, a fail-closed static drift checker, native tests, and the
migration/recovery operating contract. The checker refuses database URL inputs and performs no
database or network action.

Ten native tests cover canonical ordering and hashes, fresh/upgrade phase shape, live-input rejection,
SQL drift, exact directory/manifest set equality, missing and unowned SQL, reused filenames, path
escapes, renamed/swapped files, exact ID-derived filenames, old-reader drain gating, required
contract recovery metadata, rollback drift, and exact-enum forward-fix recovery. No dependency was
installed and no environment file, secret, database, service, container, or network endpoint was
read or mutated.

Maturity before: `WORKFLOW_PLANNED`. Maturity after: `CONTRACT_VERIFIED`.
Independent reviewer `/root/packet_schema` reran 10 tests, static and live-input
rejection checks, verified exact SQL ownership/identity/recovery semantics and
all eight hashes, and returned `PASS` with no blockers. Static and fixture validation does not
prove a real PostgreSQL fresh install, upgrade, rollback, restore, concurrency behavior, Atlas
readiness, or authority to migrate.

WO-AEH-015 integration added the later additive `0002_durable_control_schema` migration. The
checker now permits strictly ordered later `expand` migrations instead of misclassifying them as
forward fixes; every `contract` migration independently retains its drain, rollback, backup, and
recovery gates. The original ten-test WO-AEH-009 regression suite passes against the resulting
`expand -> contract -> expand` manifest. Updated hashes in the evidence bind this integration but
do not replace the recorded independent review or claim database execution.

WO-AEH-016 subsequently added the additive `0003_claim_lease_engine` functions and rollback. The
same ten-test migration regression suite passes against `expand -> contract -> expand -> expand`;
contract-phase gates remain unchanged. Updated evidence hashes bind this later integration without
claiming it was part of the original WO-AEH-009 independent review.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```
