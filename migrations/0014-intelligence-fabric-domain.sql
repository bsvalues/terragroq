BEGIN;

-- IF-01 (issue #964): persistence seam for the WilliamOS Intelligence Fabric domain objects.
--
-- The Zod contracts at components/operator/intelligence-fabric-contracts.ts are the source of
-- truth; these tables persist them FAITHFULLY -- every contract field has a home, cross-object
-- references are by immutable identity string scoped to the owning user, and lifecycle/verdict/state
-- columns carry exactly the contract enums (no more, no less). Additive only: CREATE TABLE IF NOT
-- EXISTS, nothing live is altered, nothing is backfilled. Rollback = drop these eight tables.
--
-- Faithfulness rules enforced here (the Zod layer enforces the rest):
--   * immutable identity is execution identity; mutable names never are;
--   * sha256 digests are format-pinned at the column level;
--   * cross-object references are (userId, <object>Key) -> (userId, key) composite FKs, so a row for
--     one owner can never reference another owner's object;
--   * every row is per-user scoped and cascades on user delete like the rest of the governed model.

CREATE TABLE IF NOT EXISTS "fabric_model_artifact" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "modelKey" text NOT NULL,            -- contract id (mutable display alias lives in "alias")
  "family" text NOT NULL,
  "repository" text NOT NULL,
  "source" text NOT NULL,              -- contract source (where the artifact came from)
  "revision" text NOT NULL,
  "immutableIdentity" text NOT NULL,   -- contract: repository@revision, execution identity
  "alias" text,
  "architecture" text NOT NULL,
  "modalities" text[] NOT NULL DEFAULT '{}',
  "artifactDigest" text,
  "tokenizerDigest" text,
  "chatTemplateDigest" text,
  "configDigest" text,
  "license" jsonb NOT NULL,
  "quantization" jsonb NOT NULL,
  "context" jsonb NOT NULL,
  "sourceTrust" text NOT NULL,
  "admission" text NOT NULL DEFAULT 'DISCOVERED',
  "admissionEvidence" jsonb,
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_model_artifact_pk" UNIQUE("userId","modelKey"),
  CONSTRAINT "fabric_model_artifact_identity_unique" UNIQUE("userId","immutableIdentity"),
  CONSTRAINT "fabric_model_artifact_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_model_artifact_sourcetrust_check" CHECK ("sourceTrust" IN ('APPROVED','QUARANTINED','UNKNOWN','DENIED')),
  CONSTRAINT "fabric_model_artifact_admission_check" CHECK ("admission" IN ('DISCOVERED','QUARANTINED','CANDIDATE','APPROVED','ACTIVE','FALLBACK','RETIRED','DENIED')),
  CONSTRAINT "fabric_model_artifact_digest_ck" CHECK (
    ("artifactDigest" IS NULL OR "artifactDigest" ~ '^sha256:[a-f0-9]{64}$')
    AND ("tokenizerDigest" IS NULL OR "tokenizerDigest" ~ '^sha256:[a-f0-9]{64}$')
    AND ("chatTemplateDigest" IS NULL OR "chatTemplateDigest" ~ '^sha256:[a-f0-9]{64}$')
    AND ("configDigest" IS NULL OR "configDigest" ~ '^sha256:[a-f0-9]{64}$')
  )
);

CREATE TABLE IF NOT EXISTS "fabric_runtime" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "runtimeKey" text NOT NULL,          -- contract id
  "kind" text NOT NULL,
  "version" text NOT NULL,             -- immutable revision
  "buildIdentity" text,
  "artifact" jsonb NOT NULL,           -- contract RuntimeArtifact (image/binary/provider-managed + digest)
  "endpointClass" text,
  "lifecycle" text NOT NULL DEFAULT 'UNKNOWN',
  "features" text[] NOT NULL DEFAULT '{}',
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_runtime_pk" UNIQUE("userId","runtimeKey"),
  CONSTRAINT "fabric_runtime_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_runtime_kind_check" CHECK ("kind" IN ('OLLAMA','LLAMA_CPP','VLLM','HERMES_AGENT','EXTERNAL_API','SPECIALIST')),
  CONSTRAINT "fabric_runtime_endpoint_check" CHECK ("endpointClass" IS NULL OR "endpointClass" IN ('OPENAI_COMPATIBLE','NATIVE','CLI','INTERNAL')),
  CONSTRAINT "fabric_runtime_lifecycle_check" CHECK ("lifecycle" IN ('UNKNOWN','OFFLINE','STARTING','HEALTHY','DEGRADED','FAILED','STOPPING'))
);

CREATE TABLE IF NOT EXISTS "fabric_runtime_capability" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "runtimeRef" text NOT NULL,          -- contract runtimeId (immutable runtime key)
  "runtimeVersion" text NOT NULL,      -- contract: capability pinned to an exact runtime revision
  "hardwarePlatform" text NOT NULL,
  "feature" text NOT NULL,
  "verdict" text NOT NULL DEFAULT 'UNKNOWN',
  "evidenceRef" text,
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_runtime_capability_pk" UNIQUE("userId","runtimeRef","hardwarePlatform","feature"),
  CONSTRAINT "fabric_runtime_capability_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_runtime_capability_runtime_fk" FOREIGN KEY ("userId","runtimeRef") REFERENCES "fabric_runtime"("userId","runtimeKey") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_runtime_capability_verdict_check" CHECK ("verdict" IN ('UNKNOWN','SUPPORTED','MEASURED','PROVEN','DEGRADED','FAILED','UNAVAILABLE'))
);

CREATE TABLE IF NOT EXISTS "fabric_compute_resource" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "resourceKey" text NOT NULL,         -- contract id
  "fabricNodeId" text,
  "providerId" text,
  "providerResourceId" text,
  "placement" text NOT NULL,           -- contract placement class
  "trustClass" text NOT NULL,
  "health" text NOT NULL DEFAULT 'UNKNOWN',
  "lifecycle" text NOT NULL DEFAULT 'UNKNOWN',
  "hardwareDisclosure" text NOT NULL,
  "accelerators" jsonb NOT NULL DEFAULT '[]',
  "cpu" jsonb,
  "systemMemoryBytes" bigint,
  "storageClass" text,
  "networkClass" text,
  "expiresAt" timestamp with time zone,
  "observedAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_compute_resource_pk" UNIQUE("userId","resourceKey"),
  CONSTRAINT "fabric_compute_resource_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_compute_resource_placement_check" CHECK ("placement" IN ('LOCAL_HOST','LOCAL_FABRIC','PRIVATE_REMOTE','PROVIDER_MANAGED')),
  CONSTRAINT "fabric_compute_resource_health_check" CHECK ("health" IN ('UNKNOWN','AVAILABLE','RESERVED','DEGRADED','DRAINING','UNAVAILABLE','DESTROYED')),
  CONSTRAINT "fabric_compute_resource_lifecycle_check" CHECK ("lifecycle" IN ('UNKNOWN','OFFLINE','AVAILABLE','RESERVED','DEGRADED','DRAINING','FAILED','DESTROYED')),
  CONSTRAINT "fabric_compute_resource_disclosure_check" CHECK ("hardwareDisclosure" IN ('ATTESTED','SELF_REPORTED','PROVIDER_UNDISCLOSED'))
);

CREATE TABLE IF NOT EXISTS "fabric_context_package" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "packageKey" text NOT NULL,          -- contract id
  "schemaVersion" integer NOT NULL,
  "projectId" text,
  "threadId" text,
  "workOrderRef" text,
  "sourceRefs" text[] NOT NULL DEFAULT '{}',
  "authorityRef" text,
  "classification" text NOT NULL,
  "includedSections" jsonb NOT NULL,
  "excludedClasses" text[] NOT NULL DEFAULT '{}',
  "compressionSteps" jsonb NOT NULL DEFAULT '[]',
  "provenance" jsonb NOT NULL,
  "estimatedTokens" integer,
  "digest" text NOT NULL,
  "compiledAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_context_package_pk" UNIQUE("userId","packageKey"),
  CONSTRAINT "fabric_context_package_digest_unique" UNIQUE("userId","digest"),
  CONSTRAINT "fabric_context_package_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_context_package_classification_check" CHECK ("classification" IN ('S0','S1','S2','S3','S4')),
  CONSTRAINT "fabric_context_package_digest_ck" CHECK ("digest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "fabric_placement_decision" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "decisionKey" text NOT NULL,         -- contract id
  "requestId" text NOT NULL,
  "requirementId" text NOT NULL,
  "contextPackageRef" text NOT NULL,   -- contract contextPackageId
  "considered" jsonb NOT NULL,         -- immutable candidate set with per-candidate refusals
  "selected" jsonb NOT NULL,           -- PlacementSelection: provider+model+runtime+compute+class
  "fallbackCandidateIds" text[] NOT NULL DEFAULT '{}',
  "policyDigest" text NOT NULL,
  "reason" text NOT NULL,
  "decidedAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_placement_decision_pk" UNIQUE("userId","decisionKey"),
  CONSTRAINT "fabric_placement_decision_context_fk" FOREIGN KEY ("userId","contextPackageRef") REFERENCES "fabric_context_package"("userId","packageKey") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "fabric_placement_decision_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_placement_decision_policy_digest_ck" CHECK ("policyDigest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "fabric_accelerator_reservation" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "reservationKey" text NOT NULL,      -- contract id
  "requestId" text NOT NULL,
  "computeResourceRef" text NOT NULL,  -- contract computeResourceId
  "workRef" text NOT NULL,
  "threadId" text,
  "modelArtifactRef" text,             -- contract modelArtifactId
  "requestedWeightBytes" bigint NOT NULL,
  "requestedKvBytes" bigint NOT NULL,
  "requestedRuntimeOverheadBytes" bigint NOT NULL,
  "requestedSystemMemoryBytes" bigint NOT NULL,
  "priority" text NOT NULL DEFAULT 'NORMAL',
  "preemptible" boolean NOT NULL DEFAULT true,
  "fencingToken" integer NOT NULL,
  "leaseExpiresAt" timestamp with time zone NOT NULL,
  "state" text NOT NULL DEFAULT 'REQUESTED',
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_accel_res_pk" UNIQUE("userId","reservationKey"),
  CONSTRAINT "fabric_accel_res_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_accel_res_resource_fk" FOREIGN KEY ("userId","computeResourceRef") REFERENCES "fabric_compute_resource"("userId","resourceKey") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "fabric_accel_res_state_check" CHECK ("state" IN ('REQUESTED','ACTIVE','PREEMPTING','RELEASED','EXPIRED','FAILED')),
  CONSTRAINT "fabric_accel_res_priority_check" CHECK ("priority" IN ('REALTIME','INTERACTIVE','NORMAL','BACKGROUND','MAINTENANCE')),
  CONSTRAINT "fabric_accel_res_fence_ck" CHECK ("fencingToken" > 0),
  CONSTRAINT "fabric_accel_res_bytes_ck" CHECK ("requestedWeightBytes" >= 0 AND "requestedKvBytes" >= 0 AND "requestedRuntimeOverheadBytes" >= 0 AND "requestedSystemMemoryBytes" >= 0)
);

CREATE TABLE IF NOT EXISTS "fabric_inference_execution" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "executionKey" text NOT NULL,        -- contract id
  "requestId" text NOT NULL,
  "requirementId" text NOT NULL,
  "placementDecisionRef" text NOT NULL,
  "contextPackageRef" text NOT NULL,
  "reservationRef" text,
  "parentExecutionRef" text,
  "state" text NOT NULL DEFAULT 'QUEUED',
  "failureClass" text,
  "startedAt" timestamp with time zone,
  "finishedAt" timestamp with time zone,
  "metrics" jsonb NOT NULL DEFAULT '{}',
  "toolEvidenceRefs" text[] NOT NULL DEFAULT '{}',
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_inference_execution_pk" UNIQUE("userId","executionKey"),
  CONSTRAINT "fabric_inference_execution_user_fk" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_placement_fk" FOREIGN KEY ("userId","placementDecisionRef") REFERENCES "fabric_placement_decision"("userId","decisionKey") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_context_fk" FOREIGN KEY ("userId","contextPackageRef") REFERENCES "fabric_context_package"("userId","packageKey") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_state_check" CHECK ("state" IN ('QUEUED','LOADING','RUNNING','VALIDATING','COMPLETED','WAITING','FAILED','CANCELLED')),
  CONSTRAINT "fabric_inference_execution_failure_ck" CHECK ("failureClass" IS NULL OR "failureClass" IN ('MODEL_LOAD_FAILED','MODEL_OOM','KV_CAPACITY_EXHAUSTED','CONTEXT_TOO_LARGE','RUNTIME_UNHEALTHY','ACCELERATOR_UNAVAILABLE','CAPABILITY_UNPROVEN','PROVIDER_RATE_LIMITED','PROVIDER_AUTH_FAILED','CLOUD_CAPACITY_UNAVAILABLE','BUDGET_EXCEEDED','POLICY_DENIED_REMOTE','MODEL_OUTPUT_INVALID','TOOL_CALL_FAILED','QUALITY_GATE_FAILED','ELASTIC_IDENTITY_FAILED','ELASTIC_WIPE_FAILED','ELASTIC_DESTROY_FAILED'))
);

CREATE INDEX IF NOT EXISTS "fabric_runtime_capability_runtime_idx" ON "fabric_runtime_capability" ("userId", "runtimeRef");
CREATE INDEX IF NOT EXISTS "fabric_accel_res_resource_idx" ON "fabric_accelerator_reservation" ("userId", "computeResourceRef");
CREATE INDEX IF NOT EXISTS "fabric_inference_execution_state_idx" ON "fabric_inference_execution" ("userId", "state");

COMMIT;
