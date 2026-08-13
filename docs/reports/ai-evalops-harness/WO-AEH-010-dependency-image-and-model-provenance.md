# WO-AEH-010 execution report

Status: `COMPLETE / CONTRACT_VERIFIED / INDEPENDENT_REVIEW_PASS`; production promotion remains fail-closed.

The root package now carries the WilliamOS identity, an explicit pnpm version, and a Node compatibility range. The existing pnpm resolution graph was not regenerated: its importer specifiers remain byte-for-byte consistent with `package.json`, and the checker verifies that relationship.

Python inputs now share exact direct constraints. These constraints deliberately are not represented as a transitive or hash-locked environment. Production promotion requires a separately generated `requirements-lock.txt` with hashes under future network-authorized dependency resolution and review.

The local proof Dockerfile routes all stages through `NODE_IMAGE`. Its tag default remains available only for local compatibility; any promoted build must supply an immutable registry reference containing `@sha256:` and bind source, SBOM, and provenance digests. Model identity requires manifest, weight, prompt-template, quantization, context, provider/repository, and license bindings. LKG records require package/Python/image/model/SBOM/provenance/test bindings plus named approval.

Validation fixtures now exercise strict schemas for image/model digest identity, CycloneDX format and source/image/document bindings, an explicitly `NOT_SCANNED` result, and every LKG digest, timestamp, and approver field. They contain synthetic values and grant no authority. Package-to-lock importer comparison is bidirectional: missing, changed, and extra importer dependencies fail.

Validation commands:

- `node --test tests/ai-evalops-harness-provenance.test.mjs` — 6 passed, 0 failed.
- `node scripts/ai-evalops-harness/provenance-check.mjs .` — PASS, 0 contract errors.

Baseline is commit `13709f5789c25dea408283730a6bd35e8fd894ab`; no head commit exists because this is a working-tree materialization. The evidence enumerates all changed paths, five counters, the scoped secret-keyword scan (zero matches), repository-only rollback, and explicit non-proofs.

No package install, lock refresh, image pull, network call, deployment, live service access, or runtime mutation occurred. The policy and evidence grant no deployment or promotion authority. Evidence: `evidence/WO-AEH-010-provenance-validation.json`.

```text
OWNER_OPERATION_TOUCH_COUNT: 0
OWNER_CREDENTIAL_TOUCH_COUNT: 0
OWNER_DIAGNOSTIC_TOUCH_COUNT: 0
OWNER_ROUTINE_DECISION_COUNT: 0
OWNER_ROUTINE_CONTACT_COUNT: 0
OWNER_OPERATION_CERTIFICATION_STATE: UNVERIFIED_ZERO_OWNER_OPERATIONS
```

These are repository-scope observations, not certified owner-operation evidence.

Independent reviewer `/root/packet_matrix` reran six tests and the checker,
verified bidirectional importer equality, strict non-promotable LKG/model fixtures,
SBOM bindings, all owner counters, rollback and non-proof scope, and returned
`PASS` with no blocking findings.
