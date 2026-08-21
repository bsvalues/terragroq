-- WilliamOS sovereign schema bootstrap.
-- Generated from lib/db/schema.ts via drizzle-kit; installs the full schema onto a FRESH
-- self-hosted Postgres. Requires the pgvector extension. See docs/db/sovereign-postgres.md.
-- Do not hand-edit the table DDL below; regenerate per the doc when schema.ts changes.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "access_grant" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"publicTokenHash" text NOT NULL,
	"tokenPrefix" text,
	"scope" text NOT NULL,
	"targetResourceType" text NOT NULL,
	"targetResourceId" text NOT NULL,
	"recipientEmailHash" text,
	"recipientEmailEncrypted" text,
	"emailVerificationRequired" boolean DEFAULT false NOT NULL,
	"createdByOperatorId" text NOT NULL,
	"createdReason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"maxUses" integer DEFAULT 1 NOT NULL,
	"useCount" integer DEFAULT 0 NOT NULL,
	"lastUsedAt" timestamp,
	"revokedAt" timestamp,
	"revokedBy" text,
	"revokeReason" text,
	"metadata" jsonb,
	"auditCorrelationId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_grant_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"grantId" integer,
	"correlationId" text NOT NULL,
	"eventType" text NOT NULL,
	"actorType" text NOT NULL,
	"outcome" text NOT NULL,
	"scope" text,
	"targetResourceType" text,
	"targetResourceId" text,
	"reasonCode" text,
	"ipAddressHash" text,
	"userAgentHash" text,
	"tokenPrefix" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_grant_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"grantId" integer NOT NULL,
	"sessionTokenHash" text NOT NULL,
	"recipientEmailVerified" boolean DEFAULT false NOT NULL,
	"ipAddressHash" text,
	"userAgentHash" text,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_claim" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"agent" text NOT NULL,
	"claim" text NOT NULL,
	"classification" text DEFAULT 'REQUIRES_VERIFICATION' NOT NULL,
	"workOrderId" integer,
	"evidenceId" integer,
	"command" text,
	"repo" text,
	"branch" text,
	"head" text,
	"conflictId" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authority_grant" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"workOrderId" integer,
	"grantedBy" text NOT NULL,
	"grantedTo" text DEFAULT 'operator' NOT NULL,
	"authorityLevel" text NOT NULL,
	"scope" text,
	"allowedActions" text[] DEFAULT '{}' NOT NULL,
	"blockedActions" text[] DEFAULT '{}' NOT NULL,
	"reason" text,
	"status" text DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp,
	"revokedAt" timestamp,
	"revokedBy" text,
	"revokeReason" text,
	"contentHash" text,
	"createdAt" timestamp DEFAULT timezone('UTC', now()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"detectedBetween" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"system" text,
	"workOrderId" integer,
	"doctrineRule" text,
	"description" text,
	"resolution" text,
	"resolvedBy" text,
	"resolvedAt" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"title" text NOT NULL,
	"context" text,
	"decision" text NOT NULL,
	"rationale" text,
	"consequences" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"authority" text DEFAULT 'advisory' NOT NULL,
	"owner" text DEFAULT 'Bill' NOT NULL,
	"scope" text,
	"evidence" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"supersedesId" integer,
	"supersededById" integer,
	"reviewAt" timestamp,
	"decidedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_auth_event" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"credentialId" text,
	"sessionId" text,
	"eventType" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_event_type_check" CHECK (length(trim("device_auth_event"."eventType")) > 0)
);
--> statement-breakpoint
CREATE TABLE "device_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"credentialId" text,
	"purpose" text NOT NULL,
	"challengeHash" text NOT NULL,
	"origin" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"consumedAt" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_challenge_purpose_check" CHECK ("device_challenge"."purpose" IN ('enroll', 'authenticate')),
	CONSTRAINT "device_challenge_hash_check" CHECK ("device_challenge"."challengeHash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_challenge_attempts_check" CHECK ("device_challenge"."attempts" >= 0),
	CONSTRAINT "device_challenge_expiry_check" CHECK ("device_challenge"."expiresAt" > "device_challenge"."createdAt"),
	CONSTRAINT "device_challenge_consumed_check" CHECK ("device_challenge"."consumedAt" IS NULL OR "device_challenge"."consumedAt" >= "device_challenge"."createdAt")
);
--> statement-breakpoint
CREATE TABLE "device_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'owner' NOT NULL,
	"publicKeySpki" text NOT NULL,
	"publicKeyFingerprintSha256" text NOT NULL,
	"activeAt" timestamp with time zone DEFAULT now() NOT NULL,
	"revokedAt" timestamp with time zone,
	"lastUsedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_credential_fingerprint_check" CHECK ("device_credential"."publicKeyFingerprintSha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_credential_label_check" CHECK (length(trim("device_credential"."label")) > 0),
	CONSTRAINT "device_credential_kind_check" CHECK ("device_credential"."kind" IN ('owner', 'runtime')),
	CONSTRAINT "device_credential_spki_check" CHECK (length("device_credential"."publicKeySpki") > 0)
);
--> statement-breakpoint
CREATE TABLE "device_session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"credentialId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"lastSeenAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_session_token_hash_check" CHECK ("device_session"."tokenHash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "device_session_expiry_check" CHECK ("device_session"."expiresAt" > "device_session"."createdAt"),
	CONSTRAINT "device_session_revoked_check" CHECK ("device_session"."revokedAt" IS NULL OR "device_session"."revokedAt" >= "device_session"."createdAt"),
	CONSTRAINT "device_session_last_seen_check" CHECK ("device_session"."lastSeenAt" IS NULL OR "device_session"."lastSeenAt" >= "device_session"."createdAt")
);
--> statement-breakpoint
CREATE TABLE "doctrine" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"title" text NOT NULL,
	"statement" text NOT NULL,
	"category" text DEFAULT 'principle' NOT NULL,
	"scope" text,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"allowed" text[] DEFAULT '{}' NOT NULL,
	"forbidden" text[] DEFAULT '{}' NOT NULL,
	"requiresApproval" text[] DEFAULT '{}' NOT NULL,
	"evidence" text[] DEFAULT '{}' NOT NULL,
	"owner" text DEFAULT 'Bill' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"supersedesId" integer,
	"supersededById" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"source" text,
	"mimeType" text DEFAULT 'text/plain' NOT NULL,
	"content" text NOT NULL,
	"chunkCount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'indexed' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunk" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"documentId" integer NOT NULL,
	"chunkIndex" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"register" text,
	"refId" integer,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"workOrderId" integer NOT NULL,
	"result" text NOT NULL,
	"repo" text,
	"branch" text,
	"head" text,
	"worktreeStatus" text,
	"filesChanged" text[] DEFAULT '{}' NOT NULL,
	"validators" text[] DEFAULT '{}' NOT NULL,
	"knownFailures" text[] DEFAULT '{}' NOT NULL,
	"outOfScopeChanges" text[] DEFAULT '{}' NOT NULL,
	"deferredItems" text[] DEFAULT '{}' NOT NULL,
	"nextValidMove" text,
	"notes" text,
	"contentHash" text,
	"artifactPath" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_world" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"resourceIdentity" text,
	"workOrderRef" text,
	"intent" text NOT NULL,
	"projection" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_world_user_id_unique" UNIQUE("userId","id")
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"command" text NOT NULL,
	"lane" text NOT NULL,
	"mode" text NOT NULL,
	"risk" text NOT NULL,
	"authority" text DEFAULT 'A0_READ_ONLY' NOT NULL,
	"verdict" text NOT NULL,
	"rationale" text,
	"mistakePatterns" text[] DEFAULT '{}' NOT NULL,
	"matchedRules" text[] DEFAULT '{}' NOT NULL,
	"recommendedMove" text,
	"requiresApproval" boolean DEFAULT false NOT NULL,
	"linkedWorkOrderId" integer,
	"status" text DEFAULT 'classified' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_outcome_intake_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"requestHash" text NOT NULL,
	"goalId" integer NOT NULL,
	"outcomeKey" text NOT NULL,
	"resultDigest" text NOT NULL,
	"replayCount" integer DEFAULT 0 NOT NULL,
	"firstSubmittedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastReplayedAt" timestamp with time zone,
	CONSTRAINT "goal_outcome_intake_receipt_user_key_unique" UNIQUE("userId","idempotencyKey"),
	CONSTRAINT "goal_outcome_intake_receipt_user_goal_unique" UNIQUE("userId","goalId"),
	CONSTRAINT "goal_outcome_intake_receipt_user_outcome_unique" UNIQUE("userId","outcomeKey"),
	CONSTRAINT "goal_outcome_intake_receipt_replay_count_check" CHECK ("goal_outcome_intake_receipt"."replayCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "governance_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"eventType" text NOT NULL,
	"entityType" text,
	"entityId" text,
	"actor" text,
	"reason" text,
	"beforeHash" text,
	"afterHash" text,
	"evidenceId" integer,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lock_record" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"kind" text DEFAULT 'HOLD' NOT NULL,
	"title" text NOT NULL,
	"scope" text,
	"posture" text,
	"reason" text,
	"allowedActions" text[] DEFAULT '{}' NOT NULL,
	"blockedActions" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"newPosture" text,
	"releasedBy" text,
	"releaseReason" text,
	"releasedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loop_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"target" text NOT NULL,
	"workOrderId" integer,
	"loopType" text NOT NULL,
	"authority" text DEFAULT 'A0_READ_ONLY' NOT NULL,
	"iteration" integer DEFAULT 1 NOT NULL,
	"maxIterations" integer DEFAULT 1 NOT NULL,
	"mode" text,
	"actionsTaken" text[] DEFAULT '{}' NOT NULL,
	"evidenceCollected" text[] DEFAULT '{}' NOT NULL,
	"findings" text[] DEFAULT '{}' NOT NULL,
	"blockers" text[] DEFAULT '{}' NOT NULL,
	"stopReason" text,
	"nextValidMove" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_fact" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"content" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"source" text,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"authority" text DEFAULT 'unreviewed' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"embedding" vector(1024),
	"reviewedAt" timestamp,
	"lastUsedAt" timestamp,
	"supersededById" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_queue_acquisition_attempt" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"campaignWindowId" text NOT NULL,
	"processIdentity" text NOT NULL,
	"leaseHolder" text NOT NULL,
	"acquisitionKeyDigest" text NOT NULL,
	"leaseIdentityDigest" text NOT NULL,
	"checkpointDigest" text NOT NULL,
	"checkpointOutcomeId" text NOT NULL,
	"checkpointSequence" integer NOT NULL,
	"checkpointState" text NOT NULL,
	"checkpointHeadSha" text,
	"checkpointMergeSha" text,
	"checkpointPrNumber" integer,
	"outcomeKey" text,
	"fencingToken" integer,
	"leaseExpiresAt" timestamp with time zone,
	"activeWorkOrderId" integer,
	"disposition" text NOT NULL,
	"reason" text,
	"attemptedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_queue_acquisition_attempt_fence_check" CHECK ("outcome_queue_acquisition_attempt"."fencingToken" IS NULL OR "outcome_queue_acquisition_attempt"."fencingToken" > 0),
	CONSTRAINT "outcome_queue_acquisition_attempt_checkpoint_check" CHECK ("outcome_queue_acquisition_attempt"."checkpointSequence" >= 0
        AND ("outcome_queue_acquisition_attempt"."checkpointPrNumber" IS NULL OR "outcome_queue_acquisition_attempt"."checkpointPrNumber" > 0))
);
--> statement-breakpoint
CREATE TABLE "outcome_queue_acquisition_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"acquisitionKey" text NOT NULL,
	"outcomeKey" text NOT NULL,
	"firstFencingToken" integer NOT NULL,
	"latestFencingToken" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_queue_acquisition_receipt_user_key_unique" UNIQUE("userId","acquisitionKey"),
	CONSTRAINT "outcome_queue_acquisition_receipt_fence_check" CHECK ("outcome_queue_acquisition_receipt"."firstFencingToken" > 0
        AND "outcome_queue_acquisition_receipt"."latestFencingToken" >= "outcome_queue_acquisition_receipt"."firstFencingToken")
);
--> statement-breakpoint
CREATE TABLE "outcome_queue_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"outcomeKey" text NOT NULL,
	"goalId" integer,
	"goalRef" text,
	"title" text NOT NULL,
	"objective" text,
	"queueOrder" integer DEFAULT 0 NOT NULL,
	"dependencyKeys" text[] DEFAULT '{}' NOT NULL,
	"riskClass" text DEFAULT 'R1' NOT NULL,
	"approvalState" text DEFAULT 'unapproved' NOT NULL,
	"approvedBy" text,
	"approvedAt" timestamp with time zone,
	"approvalDecisionId" integer,
	"authorityState" text DEFAULT 'unverified' NOT NULL,
	"authorityLevel" text DEFAULT 'A0_READ_ONLY' NOT NULL,
	"authorityGrantRef" text,
	"authoritySubject" text DEFAULT 'operator' NOT NULL,
	"authorityAction" text DEFAULT 'outcome:execute' NOT NULL,
	"lifecycleState" text DEFAULT 'suggested' NOT NULL,
	"lifecycleReason" text,
	"activeWorkOrderId" integer,
	"executionBinding" text,
	"leaseHolder" text,
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"fencingToken" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"acquisitionKey" text,
	"terminalResult" text,
	"terminalEvidenceId" integer,
	"terminalEvidenceRefs" text[] DEFAULT '{}' NOT NULL,
	"terminalKey" text,
	"supersedesOutcomeKey" text,
	"supersededByOutcomeKey" text,
	"suggestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"activatedAt" timestamp with time zone,
	"terminalAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_queue_item_lifecycle_state_check" CHECK ("outcome_queue_item"."lifecycleState" IN ('suggested', 'approved', 'blocked', 'active', 'completed', 'declined', 'superseded')),
	CONSTRAINT "outcome_queue_item_approval_state_check" CHECK ("outcome_queue_item"."approvalState" IN ('unapproved', 'approved', 'revoked')),
	CONSTRAINT "outcome_queue_item_authority_state_check" CHECK ("outcome_queue_item"."authorityState" IN ('unverified', 'matched', 'denied', 'expired', 'revoked')),
	CONSTRAINT "outcome_queue_item_nonnegative_fence_check" CHECK ("outcome_queue_item"."fencingToken" >= 0 AND "outcome_queue_item"."version" >= 0),
	CONSTRAINT "outcome_queue_item_active_binding_check" CHECK ("outcome_queue_item"."lifecycleState" <> 'active' OR (
        "outcome_queue_item"."executionBinding" IS NOT NULL
        AND "outcome_queue_item"."leaseHolder" IS NOT NULL
        AND "outcome_queue_item"."leaseToken" IS NOT NULL
        AND "outcome_queue_item"."leaseExpiresAt" IS NOT NULL
        AND "outcome_queue_item"."acquisitionKey" IS NOT NULL
        AND "outcome_queue_item"."fencingToken" > 0
      ))
);
--> statement-breakpoint
CREATE TABLE "outcome_queue_mutation_attempt" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"requestHash" text NOT NULL,
	"resultDigest" text NOT NULL,
	"attemptOrdinal" integer NOT NULL,
	"disposition" text NOT NULL,
	"attemptedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_queue_mutation_attempt_user_ordinal_unique" UNIQUE("userId","idempotencyKey","attemptOrdinal"),
	CONSTRAINT "outcome_queue_mutation_attempt_ordinal_check" CHECK ("outcome_queue_mutation_attempt"."attemptOrdinal" > 0),
	CONSTRAINT "outcome_queue_mutation_attempt_disposition_check" CHECK ("outcome_queue_mutation_attempt"."disposition" IN ('COMMITTED', 'REPLAY'))
);
--> statement-breakpoint
CREATE TABLE "outcome_queue_mutation_receipt" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"operation" text NOT NULL,
	"outcomeKey" text,
	"requestHash" text NOT NULL,
	"requestBinding" jsonb NOT NULL,
	"resultBinding" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_queue_mutation_receipt_user_key_unique" UNIQUE("userId","idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "parked_idea" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"idea" text NOT NULL,
	"lane" text,
	"whyItMatters" text,
	"whyNotNow" text,
	"maturity" text DEFAULT 'seed' NOT NULL,
	"unlockCondition" text,
	"relatedWorkOrderId" integer,
	"promoteRequires" text,
	"status" text DEFAULT 'parked' NOT NULL,
	"promotedWorkOrderId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle" text DEFAULT 'standby' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_user_key_unique" UNIQUE("userId","key"),
	CONSTRAINT "project_user_id_unique" UNIQUE("userId","id"),
	CONSTRAINT "project_lifecycle_check" CHECK ("project"."lifecycle" IN ('active', 'standby', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "project_resource" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"projectId" integer NOT NULL,
	"type" text NOT NULL,
	"canonicalIdentity" text NOT NULL,
	"label" text NOT NULL,
	"relationship" text NOT NULL,
	"allowedOperations" text[] DEFAULT '{}' NOT NULL,
	"ratifiedAt" timestamp with time zone,
	"ratifiedBy" text,
	"resourceKey" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_resource_identity_unique" UNIQUE("projectId","type","canonicalIdentity","relationship"),
	CONSTRAINT "project_resource_type_check" CHECK ("project_resource"."type" IN ('repo', 'database', 'node', 'service', 'data_source'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "truth_claim" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"claim" text NOT NULL,
	"system" text,
	"source" text,
	"truthType" text DEFAULT 'UNKNOWN' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"freshness" text DEFAULT 'fresh' NOT NULL,
	"evidenceId" integer,
	"verificationRequiredBefore" text[] DEFAULT '{}' NOT NULL,
	"capturedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"projectId" integer NOT NULL,
	"title" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_thread_user_id_unique" UNIQUE("userId","id")
);
--> statement-breakpoint
CREATE TABLE "workbench_thread_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"threadId" text NOT NULL,
	"sourceType" text NOT NULL,
	"sourceId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_thread_source_binding_unique" UNIQUE("userId","threadId","sourceType","sourceId"),
	CONSTRAINT "workbench_thread_source_type_check" CHECK ("workbench_thread_source"."sourceType" IN ('goal', 'outcome')),
	CONSTRAINT "workbench_thread_source_role_check" CHECK ("workbench_thread_source"."role" IN ('root', 'member'))
);
--> statement-breakpoint
CREATE TABLE "working_world" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"intent" text NOT NULL,
	"snapshot" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workbench_thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"threadId" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workbench_thread_message_role_check" CHECK ("workbench_thread_message"."role" IN ('owner', 'williamos'))
);
--> statement-breakpoint
CREATE TABLE "work_order" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"ref" text,
	"title" text NOT NULL,
	"description" text,
	"goal" text,
	"loop" text,
	"scope" text,
	"nonGoals" text[] DEFAULT '{}' NOT NULL,
	"allowedFiles" text[] DEFAULT '{}' NOT NULL,
	"forbiddenFiles" text[] DEFAULT '{}' NOT NULL,
	"validators" text[] DEFAULT '{}' NOT NULL,
	"stopConditions" text[] DEFAULT '{}' NOT NULL,
	"lane" text,
	"phase" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee" text,
	"authorityLevel" text DEFAULT 'A0_READ_ONLY' NOT NULL,
	"authorityGranted" text,
	"authorityGrantId" integer,
	"acceptanceCriteria" text[] DEFAULT '{}' NOT NULL,
	"agent" text,
	"approvedBy" text,
	"approvedAt" timestamp,
	"linkedDecisionId" integer,
	"evidence" text[] DEFAULT '{}' NOT NULL,
	"result" text,
	"commitRef" text,
	"tagRef" text,
	"commitAllowed" boolean DEFAULT false NOT NULL,
	"tagAllowed" boolean DEFAULT false NOT NULL,
	"pushAllowed" boolean DEFAULT false NOT NULL,
	"supersedesId" integer,
	"supersededById" integer,
	"dueAt" timestamp,
	"closedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_grant_event" ADD CONSTRAINT "access_grant_event_grantId_access_grant_id_fk" FOREIGN KEY ("grantId") REFERENCES "public"."access_grant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant_session" ADD CONSTRAINT "access_grant_session_grantId_access_grant_id_fk" FOREIGN KEY ("grantId") REFERENCES "public"."access_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_event" ADD CONSTRAINT "device_auth_event_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_event" ADD CONSTRAINT "device_auth_event_credentialId_device_credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."device_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_event" ADD CONSTRAINT "device_auth_event_sessionId_device_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."device_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_challenge" ADD CONSTRAINT "device_challenge_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_challenge" ADD CONSTRAINT "device_challenge_credentialId_device_credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."device_credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credential" ADD CONSTRAINT "device_credential_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_session" ADD CONSTRAINT "device_session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_session" ADD CONSTRAINT "device_session_credentialId_device_credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."device_credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_outcome_intake_receipt" ADD CONSTRAINT "goal_outcome_intake_receipt_goalId_goal_id_fk" FOREIGN KEY ("goalId") REFERENCES "public"."goal"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_world" ADD CONSTRAINT "environment_world_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_queue_item" ADD CONSTRAINT "outcome_queue_item_goalId_goal_id_fk" FOREIGN KEY ("goalId") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_queue_item" ADD CONSTRAINT "outcome_queue_item_approvalDecisionId_decision_id_fk" FOREIGN KEY ("approvalDecisionId") REFERENCES "public"."decision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_queue_item" ADD CONSTRAINT "outcome_queue_item_activeWorkOrderId_work_order_id_fk" FOREIGN KEY ("activeWorkOrderId") REFERENCES "public"."work_order"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resource" ADD CONSTRAINT "project_resource_projectId_project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_thread" ADD CONSTRAINT "workbench_thread_user_project_fk" FOREIGN KEY ("userId","projectId") REFERENCES "public"."project"("userId","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_thread_source" ADD CONSTRAINT "workbench_thread_source_user_thread_fk" FOREIGN KEY ("userId","threadId") REFERENCES "public"."workbench_thread"("userId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workbench_thread_message" ADD CONSTRAINT "workbench_thread_message_user_thread_fk" FOREIGN KEY ("userId","threadId") REFERENCES "public"."workbench_thread"("userId","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grant_public_token_hash_idx" ON "access_grant" USING btree ("publicTokenHash");--> statement-breakpoint
CREATE INDEX "access_grant_user_status_expires_idx" ON "access_grant" USING btree ("userId","status","expiresAt");--> statement-breakpoint
CREATE INDEX "access_grant_target_idx" ON "access_grant" USING btree ("targetResourceType","targetResourceId");--> statement-breakpoint
CREATE INDEX "access_grant_recipient_email_hash_idx" ON "access_grant" USING btree ("recipientEmailHash");--> statement-breakpoint
CREATE INDEX "access_grant_event_grant_created_idx" ON "access_grant_event" USING btree ("grantId","createdAt");--> statement-breakpoint
CREATE INDEX "access_grant_event_correlation_idx" ON "access_grant_event" USING btree ("correlationId");--> statement-breakpoint
CREATE INDEX "access_grant_event_type_created_idx" ON "access_grant_event" USING btree ("eventType","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "access_grant_session_token_hash_idx" ON "access_grant_session" USING btree ("sessionTokenHash");--> statement-breakpoint
CREATE INDEX "access_grant_session_grant_expires_idx" ON "access_grant_session" USING btree ("grantId","expiresAt");--> statement-breakpoint
CREATE INDEX "device_auth_event_user_created_idx" ON "device_auth_event" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "device_auth_event_credential_created_idx" ON "device_auth_event" USING btree ("credentialId","createdAt");--> statement-breakpoint
CREATE INDEX "device_auth_event_session_created_idx" ON "device_auth_event" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE INDEX "device_auth_event_type_created_idx" ON "device_auth_event" USING btree ("eventType","createdAt");--> statement-breakpoint
CREATE INDEX "environment_world_user_updated_idx" ON "environment_world" USING btree ("userId","updatedAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_challenge_hash_idx" ON "device_challenge" USING btree ("challengeHash");--> statement-breakpoint
CREATE INDEX "device_challenge_user_purpose_created_idx" ON "device_challenge" USING btree ("userId","purpose","createdAt");--> statement-breakpoint
CREATE INDEX "device_challenge_credential_purpose_created_idx" ON "device_challenge" USING btree ("credentialId","purpose","createdAt");--> statement-breakpoint
CREATE INDEX "device_challenge_origin_purpose_created_idx" ON "device_challenge" USING btree ("origin","purpose","createdAt");--> statement-breakpoint
CREATE INDEX "device_challenge_expiry_idx" ON "device_challenge" USING btree ("expiresAt","consumedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "device_credential_fingerprint_idx" ON "device_credential" USING btree ("publicKeyFingerprintSha256");--> statement-breakpoint
CREATE INDEX "device_credential_user_active_idx" ON "device_credential" USING btree ("userId","revokedAt","activeAt");--> statement-breakpoint
CREATE UNIQUE INDEX "device_session_token_hash_idx" ON "device_session" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "device_session_user_expiry_idx" ON "device_session" USING btree ("userId","expiresAt","revokedAt");--> statement-breakpoint
CREATE INDEX "device_session_credential_expiry_idx" ON "device_session" USING btree ("credentialId","expiresAt","revokedAt");--> statement-breakpoint
CREATE INDEX "outcome_queue_acquisition_attempt_campaign_idx" ON "outcome_queue_acquisition_attempt" USING btree ("userId","campaignWindowId","attemptedAt");--> statement-breakpoint
CREATE INDEX "outcome_queue_acquisition_attempt_identity_idx" ON "outcome_queue_acquisition_attempt" USING btree ("userId","acquisitionKeyDigest","attemptedAt");--> statement-breakpoint
CREATE INDEX "outcome_queue_acquisition_receipt_user_outcome_idx" ON "outcome_queue_acquisition_receipt" USING btree ("userId","outcomeKey");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_queue_item_user_key_idx" ON "outcome_queue_item" USING btree ("userId","outcomeKey");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_queue_item_user_acquisition_idx" ON "outcome_queue_item" USING btree ("userId","acquisitionKey");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_queue_item_user_terminal_idx" ON "outcome_queue_item" USING btree ("userId","terminalKey");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_queue_item_one_active_per_user_idx" ON "outcome_queue_item" USING btree ("userId") WHERE "outcome_queue_item"."lifecycleState" = 'active';--> statement-breakpoint
CREATE INDEX "outcome_queue_item_selection_idx" ON "outcome_queue_item" USING btree ("userId","lifecycleState","approvalState","authorityState","queueOrder");--> statement-breakpoint
CREATE INDEX "outcome_queue_item_lease_idx" ON "outcome_queue_item" USING btree ("userId","lifecycleState","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "outcome_queue_item_goal_idx" ON "outcome_queue_item" USING btree ("goalId");--> statement-breakpoint
CREATE INDEX "outcome_queue_item_approval_decision_idx" ON "outcome_queue_item" USING btree ("approvalDecisionId");--> statement-breakpoint
CREATE INDEX "outcome_queue_item_work_order_idx" ON "outcome_queue_item" USING btree ("activeWorkOrderId");--> statement-breakpoint
CREATE INDEX "outcome_queue_mutation_attempt_request_idx" ON "outcome_queue_mutation_attempt" USING btree ("userId","requestHash","attemptedAt");--> statement-breakpoint
CREATE INDEX "outcome_queue_mutation_receipt_user_outcome_idx" ON "outcome_queue_mutation_receipt" USING btree ("userId","outcomeKey","createdAt");
--> statement-breakpoint
CREATE INDEX "project_resource_user_project_idx" ON "project_resource" USING btree ("userId","projectId");--> statement-breakpoint
CREATE INDEX "project_resource_user_identity_idx" ON "project_resource" USING btree ("userId","type","canonicalIdentity");
--> statement-breakpoint
CREATE INDEX "project_resource_resource_key_idx" ON "project_resource" USING btree ("userId","resourceKey");
--> statement-breakpoint
CREATE INDEX "workbench_thread_user_project_updated_idx" ON "workbench_thread" USING btree ("userId","projectId","updatedAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workbench_thread_source_root_unique_idx" ON "workbench_thread_source" USING btree ("userId","sourceType","sourceId") WHERE "workbench_thread_source"."role" = 'root';--> statement-breakpoint
CREATE UNIQUE INDEX "workbench_thread_source_thread_root_unique_idx" ON "workbench_thread_source" USING btree ("userId","threadId") WHERE "workbench_thread_source"."role" = 'root';
--> statement-breakpoint
CREATE INDEX "working_world_user_updated_idx" ON "working_world" USING btree ("userId","updatedAt","id");
--> statement-breakpoint
CREATE INDEX "workbench_thread_message_thread_created_idx" ON "workbench_thread_message" USING btree ("userId","threadId","createdAt","id");
