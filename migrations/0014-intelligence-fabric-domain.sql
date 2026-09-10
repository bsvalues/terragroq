BEGIN;

-- IF-01 (issue #964): persistence seam for the WilliamOS Intelligence Fabric domain objects.
--
-- The Zod contracts already exist at components/operator/intelligence-fabric-contracts.ts; this
-- migration gives them a durable home. It is deliberately additive: CREATE TABLE IF NOT EXISTS only,
-- no live table is altered, no routing or provider path is touched, and nothing is backfilled.
-- Rollback is a plain DROP of these eight new tables and nothing else.
--
-- Design rules carried from the contracts and the schema's own conventions:
--   * immutable identity is execution identity; mutable display names never are;
--   * digests are sha256-pinned where the contract binds content;
--   * every row is per-user scoped like the rest of the governed model;
--   * nested/optional structure lives in jsonb with NOT NULL defaults, validated by the Zod layer.

CREATE TABLE IF NOT EXISTS "fabric_model_artifact" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "modelKey" text NOT NULL,
  "family" text NOT NULL,
  "repository" text NOT NULL,
  "revision" text NOT NULL,
  "immutableIdentity" text NOT NULL,
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
  CONSTRAINT "fabric_model_artifact_user_key_unique" UNIQUE("userId","modelKey"),
  CONSTRAINT "fabric_model_artifact_identity_unique" UNIQUE("userId","immutableIdentity"),
  CONSTRAINT "fabric_model_artifact_sourcetrust_check" CHECK ("fabric_model_artifact"."sourceTrust" IN ('APPROVED','QUARANTINED','UNKNOWN','DENIED')),
  CONSTRAINT "fabric_model_artifact_admission_check" CHECK ("fabric_model_artifact"."admission" IN ('DISCOVERED','QUARANTINED','CANDIDATE','APPROVED','ACTIVE','FALLBACK','RETIRED','DENIED')),
  CONSTRAINT "fabric_model_artifact_revision_digest_ck" CHECK ("revision" ~ '^(sha256:)?[a-f0-9]{40,64}$' OR "revision" ~ '^v?[0-9]+\.[0-9]+\.[0-9]+')
);

CREATE TABLE IF NOT EXISTS "fabric_runtime" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "runtimeKey" text NOT NULL,
  "kind" text NOT NULL,
  "version" text NOT NULL,
  "buildIdentity" text,
  "endpointClass" text,
  "lifecycle" text NOT NULL DEFAULT 'UNKNOWN',
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_runtime_user_key_unique" UNIQUE("userId","runtimeKey"),
  CONSTRAINT "fabric_runtime_kind_check" CHECK ("fabric_runtime"."kind" IN ('OLLAMA','LLAMA_CPP','VLLM','HERMES_AGENT','EXTERNAL_API','SPECIALIST')),
  CONSTRAINT "fabric_runtime_endpoint_check" CHECK ("endpointClass" IS NULL OR "endpointClass" IN ('OPENAI_COMPATIBLE','NATIVE','CLI','INTERNAL')),
  CONSTRAINT "fabric_runtime_lifecycle_check" CHECK ("fabric_runtime"."lifecycle" IN ('UNKNOWN','OFFLINE','STARTING','HEALTHY','DEGRADED','FAILED','STOPPING'))
);

CREATE TABLE IF NOT EXISTS "fabric_runtime_capability" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "runtimeId" integer NOT NULL,
  "hardwarePlatform" text NOT NULL,
  "feature" text NOT NULL,
  "verdict" text NOT NULL DEFAULT 'UNKNOWN',
  "evidenceRef" text,
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_runtime_capability_unique" UNIQUE("userId","runtimeId","hardwarePlatform","feature"),
  CONSTRAINT "fabric_runtime_capability_verdict_check" CHECK ("fabric_runtime_capability"."verdict" IN ('UNKNOWN','SUPPORTED','MEASURED','PROVEN','DEGRADED','FAILED','UNAVAILABLE')),
  CONSTRAINT "fabric_runtime_capability_runtime_fk"
    FOREIGN KEY ("runtimeId") REFERENCES "fabric_runtime"("id") ON DELETE cascade ON UPDATE no action
);

CREATE TABLE IF NOT EXISTS "fabric_compute_resource" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "resourceKey" text NOT NULL,
  "fabricNodeId" text,
  "providerId" text,
  "locationClass" text NOT NULL,
  "trustClass" text NOT NULL,
  "accelerator" jsonb,
  "cpu" jsonb,
  "systemMemoryBytes" bigint,
  "storageClass" text,
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_compute_resource_user_key_unique" UNIQUE("userId","resourceKey"),
  CONSTRAINT "fabric_compute_resource_location_check" CHECK ("fabric_compute_resource"."locationClass" IN ('LOCAL_HOST','LOCAL_FABRIC','PRIVATE_REMOTE','PROVIDER_MANAGED'))
);

CREATE TABLE IF NOT EXISTS "fabric_context_package" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "packageKey" text NOT NULL,
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
  CONSTRAINT "fabric_context_package_digest_unique" UNIQUE("userId","digest"),
  CONSTRAINT "fabric_context_package_classification_check" CHECK ("fabric_context_package"."classification" IN ('S0','S1','S2','S3','S4')),
  CONSTRAINT "fabric_context_package_digest_ck" CHECK ("digest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "fabric_placement_decision" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "decisionKey" text NOT NULL,
  "schemaVersion" integer NOT NULL,
  "requestEnvelope" jsonb NOT NULL,
  "selection" jsonb,
  "considered" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL,
  "rationale" text,
  "digest" text NOT NULL,
  "decidedAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_placement_decision_digest_unique" UNIQUE("userId","digest"),
  CONSTRAINT "fabric_placement_decision_status_check" CHECK ("fabric_placement_decision"."status" IN ('RECOMMENDED','REFUSED','NO_CAPABLE_PLACEMENT','DEFERRED')),
  CONSTRAINT "fabric_placement_decision_digest_ck" CHECK ("digest" ~ '^sha256:[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "fabric_accelerator_reservation" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "reservationKey" text NOT NULL,
  "computeResourceId" integer NOT NULL,
  "state" text NOT NULL DEFAULT 'REQUESTED',
  "leaseExpiresAt" timestamp with time zone,
  "fenceToken" text,
  "priority" text NOT NULL DEFAULT 'NORMAL',
  "workloadRef" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_accel_res_user_key_unique" UNIQUE("userId","reservationKey"),
  CONSTRAINT "fabric_accel_res_state_check" CHECK ("fabric_accelerator_reservation"."state" IN ('REQUESTED','LEASED','ACTIVE','PREEMPTED','RELEASED','EXPIRED','FENCED')),
  CONSTRAINT "fabric_accel_res_priority_check" CHECK ("fabric_accelerator_reservation"."priority" IN ('REALTIME','INTERACTIVE','NORMAL','BACKGROUND','MAINTENANCE')),
  CONSTRAINT "fabric_accel_res_resource_fk"
    FOREIGN KEY ("computeResourceId") REFERENCES "fabric_compute_resource"("id") ON DELETE restrict ON UPDATE no action
);

CREATE TABLE IF NOT EXISTS "fabric_inference_execution" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "executionKey" text NOT NULL,
  "schemaVersion" integer NOT NULL,
  "placementDecisionId" integer,
  "modelArtifactId" integer,
  "runtimeId" integer,
  "computeResourceId" integer,
  "workerLane" text,
  "state" text NOT NULL DEFAULT 'QUEUED',
  "startedAt" timestamp with time zone,
  "completedAt" timestamp with time zone,
  "metrics" jsonb,
  "evidenceRef" text,
  "digest" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fabric_inference_execution_digest_unique" UNIQUE("userId","digest"),
  CONSTRAINT "fabric_inference_execution_state_check" CHECK ("fabric_inference_execution"."state" IN ('QUEUED','DISPATCHED','RUNNING','COMPLETED','FAILED','INTERRUPTED','RECONCILE_REQUIRED')),
  CONSTRAINT "fabric_inference_execution_digest_ck" CHECK ("digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "fabric_inference_execution_placement_fk"
    FOREIGN KEY ("placementDecisionId") REFERENCES "fabric_placement_decision"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_model_fk"
    FOREIGN KEY ("modelArtifactId") REFERENCES "fabric_model_artifact"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_runtime_fk"
    FOREIGN KEY ("runtimeId") REFERENCES "fabric_runtime"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "fabric_inference_execution_compute_fk"
    FOREIGN KEY ("computeResourceId") REFERENCES "fabric_compute_resource"("id") ON DELETE set null ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "fabric_runtime_capability_runtime_idx" ON "fabric_runtime_capability" ("runtimeId");
CREATE INDEX IF NOT EXISTS "fabric_accel_res_resource_idx" ON "fabric_accelerator_reservation" ("computeResourceId");
CREATE INDEX IF NOT EXISTS "fabric_inference_execution_thread_idx" ON "fabric_inference_execution" ("userId", "state");

COMMIT;
