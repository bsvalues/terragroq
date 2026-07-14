# WO-MAO-014 - Hosted Merge and Dependent Release

Status: `MERGED_WITH_REMEDIATION_REQUIRED / FINAL_VERIFICATION_PENDING`

Lane B PR `#364` merged first as `8ec632aa`; Lane A PR `#365` merged next as `94795d37`. After both declared fan-in
dependencies were complete on main, the coordinator automatically released Lane C without an owner
prompt. Before both merges, the dependent planner lane was not eligible. Two post-merge assurance
findings mean this release remains under remediation and cannot yet serve as final lifecycle proof.

Lane C implements only deterministic planning. It validates candidate dispatch envelopes, checks
dependency completion, applies the reservation compatibility contract, assigns a stable wave order,
and emits typed blocked reasons. Follow-up assurance additionally required exact `ANY`/`ALL` fan-in
semantics and fail-closed self-validation of derived reservation sets. It records
`dispatchPerformed=false`, `authorityGranted=false`, and `atomicReservationClaimed=false`.
