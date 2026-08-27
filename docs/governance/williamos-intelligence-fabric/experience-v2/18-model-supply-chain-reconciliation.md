# 18 — Model Supply Chain, Derived Artifacts, and Lifecycle Reconciliation

## Purpose

Prevent IF-03/IF-05/IF-08 from reducing model admission to a name/tag or an ungoverned `ollama pull`. WilliamOS must know exactly which bytes, revision, license, tokenizer/template/runtime assumptions and derived transformations produced an admitted model artifact.

## Existing provenance substrate

Current WilliamOS already proves stronger model provenance in specialist paths than the generic chat/runtime configuration exposes.

The governed embedding bakeoff binds and verifies:

- exact model ID;
- revision;
- `weights_sha256`;
- license;
- source;
- model-manifest digest;
- runtime identity/version/executable/container/interpreter digests;
- host identity and inventory snapshot;
- exact pre/post model/runtime/host identity in execution evidence.

The promoted resident Hermes Agent policy also binds exact source commit, image/image digest, model ID/base model, context length and deployed artifact hashes.

These are scoped authoritative records. The Intelligence Fabric should normalize/reuse their provenance fields rather than weaken them into `modelName`.

## ModelArtifact minimum identity

A production-admissible ModelArtifact should support, when applicable:

- family/name;
- exact upstream revision/commit/tag;
- source URI/provider identity;
- source weights digest(s);
- tokenizer identity/digest;
- tokenizer/config/chat-template digest;
- architecture;
- modality;
- parameter/expert topology where relevant;
- quantization/precision;
- context declaration;
- tool/reasoning/template dialect;
- license identifier/text digest/reference;
- commercial/use/redistribution flags derived from reviewed policy, not guessed;
- source provenance/evidence refs;
- local artifact digest(s);
- creation/import time;
- admission state.

Absence of fields unsupported by a format is allowed only as explicit UNKNOWN/NOT_APPLICABLE, never silently omitted where identity ambiguity would result.

## Derived artifact lineage

Quantization, conversion, repacking and runtime-specific formats are new artifacts, not the same bytes under a new filename.

Examples include:

- GGUF conversion;
- GPTQ/AWQ/other quantization;
- Ollama manifest/blob assembly;
- FreeToken FTW or other expert-layout conversion;
- merged adapters/LoRA;
- tokenizer/template modifications;
- runtime-specific graph/engine compilation.

Every derived artifact must bind:

`source artifact digest(s) + transformation tool identity/version/digest + transformation configuration + derived artifact digest(s)`

A derived artifact inherits no capability evidence automatically unless the evaluation contract explicitly proves the transformation irrelevant to that capability.

## Admission lifecycle

Prefer an explicit lifecycle:

`DISCOVERED -> QUARANTINED -> VERIFIED -> EVALUATING -> CANDIDATE -> ADMITTED -> ACTIVE -> FALLBACK -> RETIRED`

`REJECTED` is terminal for the specific artifact identity but does not blacklist the entire model family.

Downloading/installing does not mean admitted. Admitted does not mean active. Active does not mean universally capable.

## Download/import boundary

Model acquisition is a consequential supply-chain action and must be separately authorized by policy/standing authority.

Before acquisition, WilliamOS should know or bound:

- source host/repository;
- expected model identity/revision;
- expected maximum bytes;
- license/restriction review state;
- storage destination/quota;
- whether Internet egress is required;
- whether authentication/token is required;
- whether the source permits automated redistribution/caching.

No model-facing agent should receive a Hugging Face/provider token merely to make an autonomous pull convenient.

## License/policy doctrine

License state is part of admission. WilliamOS should distinguish:

- license text/identifier observed;
- license digest/version;
- reviewed policy verdict;
- allowed private use;
- allowed commercial use;
- allowed redistribution;
- attribution/notice obligations;
- other material restrictions.

UNKNOWN license/policy state may remain quarantined/evaluable with synthetic/public data but should not silently become production-active.

## Canary and rollback

A new model/revision/runtime configuration should not overwrite the currently proven identity in place.

Prefer:

- incumbent = `ACTIVE`;
- new identity = `CANDIDATE`;
- evaluate against frozen/versioned WilliamOS corpus;
- shadow-route where safe;
- independent promotion;
- new identity becomes `ACTIVE`;
- prior proven identity becomes `FALLBACK` for a bounded rollback window;
- retire only when evidence and storage policy permit.

Rollback is an identity/routing action, not a reinstall-from-memory procedure.

## Artifact storage and deduplication

The Fabric may deduplicate identical content-addressed blobs across runtimes where format and policy permit, but logical model identities must retain their own manifests/provenance. Do not duplicate 100+ GB artifacts merely because two runtime records reference the same immutable weights, and do not hard-link/mutate shared content in ways that invalidate digest assumptions.

Storage placement should consider:

- capacity;
- cold-load bandwidth;
- node locality;
- transfer cost;
- reuse frequency;
- backup/reconstructability;
- license/redistribution policy.

Model artifacts are generally reconstructable caches/supply-chain assets, not canonical owner work. Their backup policy may therefore differ from ATLAS canonical state.

## Runtime compatibility evidence

A ModelArtifact record may declare expected compatibility, but production runtime compatibility should be evidence-backed for the exact runtime/version/hardware/configuration combination.

`model supports vLLM` as marketing metadata is not equivalent to `this exact artifact served correctly on vLLM X on Gaudi/NVIDIA Y under configuration Z`.

## Security checks

Admission should consider at minimum:

- unexpected executable/code content in formats that permit remote/custom code;
- tokenizer/template/config changes;
- unsafe runtime flags such as arbitrary remote code execution;
- model/repository source trust;
- digest mismatch;
- decompression/archive path traversal;
- disk quota exhaustion;
- malicious metadata/filenames;
- prompt/template injection embedded in system templates;
- derived-artifact transformation tool provenance.

Do not make `trust_remote_code=true` a generic convenience default.

## FreeToken consequence

FreeToken-specific converted weights must be modeled as derived artifacts with source lineage. A spectacular benchmark does not allow a converted artifact to lose the identity of the upstream model or conversion toolchain.

## Acceptance

Supply-chain reconciliation passes only when:

- existing embedding/resident provenance fields are reused or generalized without weakening;
- a model tag/name cannot uniquely identify a production artifact unless its bytes/revision are bound;
- derived conversions have cryptographic lineage;
- download/install/admit/activate are distinct actions;
- license/policy state is explicit;
- candidate/canary/rollback semantics preserve a proven fallback;
- capability evidence is scoped to exact artifact/runtime/config/compute identity;
- autonomous model download does not leak provider credentials to agents;
- content deduplication cannot mutate or confuse provenance;
- FreeToken/other runtime-specific formats remain linked to upstream source identity.
