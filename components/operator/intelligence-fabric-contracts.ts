import { z } from "zod"

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/
const sha256Pattern = /^sha256:[a-f0-9]{64}$/
const fullGitCommitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const exactSemverPattern = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const datedVersionPattern = /^(?=.*\d)(?:[A-Za-z0-9]+[._:-])*\d{4}-\d{2}-\d{2}(?:[._:-][A-Za-z0-9]+)*$/
const datedStampVersionPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._:-]*\d{8}[A-Za-z0-9._:-]*$/
const movingRevisionSegmentPattern = /^(?:x|latest|current|stable|main|master|head|trunk|develop|dev|canary|nightly|edge|preview|beta|production|prod|default)$/i

const IdentifierSchema = z.string().trim().min(1).regex(identifierPattern)
const NonEmptyStringSchema = z.string().trim().min(1)
const DigestSchema = z.string().regex(sha256Pattern)
const TimestampSchema = z.string().datetime({ offset: true })
const FiniteNonNegativeSchema = z.number().finite().nonnegative()
const PositiveIntegerSchema = z.number().int().positive()

/**
 * Immutable revisions are content digests/full commits or exact version identifiers.
 * Branch refs, moving release channels, ranges and wildcard selectors are intentionally rejected.
 */
export const ImmutableRevisionSchema = NonEmptyStringSchema.refine((revision) => {
  if (/\s|[\^~*<>=|]/.test(revision)) return false
  if (/^(?:refs\/|heads\/|remotes\/|branch:|tag:)/i.test(revision)) return false
  if (revision.split(/[._:/-]/).some((segment) => movingRevisionSegmentPattern.test(segment))) {
    return false
  }

  return (
    fullGitCommitPattern.test(revision) ||
    sha256Pattern.test(revision) ||
    exactSemverPattern.test(revision) ||
    datedVersionPattern.test(revision) ||
    datedStampVersionPattern.test(revision)
  )
}, "Revision must be a full commit, content digest, or exact pinned version; branches, aliases, moving labels, ranges, and wildcards are forbidden")

export const IntelligenceCapabilitySchema = z
  .object({
    id: IdentifierSchema,
    version: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    modalities: z
      .array(
        z.enum([
          "TEXT",
          "IMAGE",
          "AUDIO",
          "VIDEO",
          "DOCUMENT",
          "EMBEDDING",
          "RERANK",
          "STRUCTURED_DATA",
        ]),
      )
      .min(1),
    requiredFeatures: z.array(IdentifierSchema),
  })
  .strict()

const DisclosedQuantizationSchema = z
  .object({
    disclosure: z.literal("DISCLOSED"),
    format: NonEmptyStringSchema,
    bits: PositiveIntegerSchema.optional(),
    variant: NonEmptyStringSchema.optional(),
  })
  .strict()

const UndisclosedQuantizationSchema = z
  .object({
    disclosure: z.literal("PROVIDER_UNDISCLOSED"),
  })
  .strict()

const ModelAdmissionEvidenceSchema = z
  .object({
    kind: z.literal("CAPABILITY_EVIDENCE_BINDING"),
    modelImmutableIdentity: IdentifierSchema,
    capability: z
      .object({
        id: IdentifierSchema,
        version: NonEmptyStringSchema,
      })
      .strict(),
    runtime: z
      .object({
        id: IdentifierSchema,
        version: ImmutableRevisionSchema,
      })
      .strict(),
    runtimeConfigurationDigest: DigestSchema,
    computeClass: IdentifierSchema,
    evaluationId: IdentifierSchema,
    verdict: z.literal("PROVEN"),
    evidenceRef: NonEmptyStringSchema,
    measuredAt: TimestampSchema,
    promotedBy: IdentifierSchema,
  })
  .strict()

export const ModelIdentitySchema = z
  .object({
    id: IdentifierSchema,
    family: NonEmptyStringSchema,
    repository: NonEmptyStringSchema,
    source: NonEmptyStringSchema,
    revision: ImmutableRevisionSchema,
    immutableIdentity: IdentifierSchema,
    alias: IdentifierSchema.optional(),
    artifactDigest: DigestSchema.optional(),
    tokenizerDigest: DigestSchema.optional(),
    chatTemplateDigest: DigestSchema.optional(),
    configDigest: DigestSchema.optional(),
    architecture: NonEmptyStringSchema,
    modalities: z
      .array(
        z.enum([
          "TEXT",
          "IMAGE",
          "AUDIO",
          "VIDEO",
          "DOCUMENT",
          "EMBEDDING",
          "RERANK",
          "STRUCTURED_DATA",
        ]),
      )
      .min(1),
    license: z
      .object({
        id: NonEmptyStringSchema,
        evidenceRef: NonEmptyStringSchema,
        commercialUse: z.enum(["ALLOWED", "DENIED", "UNKNOWN"]),
        redistribution: z.enum(["ALLOWED", "DENIED", "UNKNOWN"]),
      })
      .strict(),
    quantization: z.union([
      DisclosedQuantizationSchema,
      UndisclosedQuantizationSchema,
    ]),
    context: z
      .object({
        maxInputTokens: PositiveIntegerSchema,
        maxOutputTokens: PositiveIntegerSchema,
        maxTotalTokens: PositiveIntegerSchema,
      })
      .strict()
      .refine(
        ({ maxInputTokens, maxOutputTokens, maxTotalTokens }) =>
          maxTotalTokens >= maxInputTokens + maxOutputTokens,
        "Model total context must cover the sum of declared input and output limits",
      ),
    sourceTrust: z.enum(["APPROVED", "QUARANTINED", "UNKNOWN", "DENIED"]),
    admission: z.enum([
      "DISCOVERED",
      "QUARANTINED",
      "CANDIDATE",
      "APPROVED",
      "ACTIVE",
      "FALLBACK",
      "RETIRED",
      "DENIED",
    ]),
    admissionEvidence: ModelAdmissionEvidenceSchema.optional(),
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((model, context) => {
    const expectedIdentity = `${model.repository}@${model.revision}`
    if (model.immutableIdentity !== expectedIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model immutableIdentity must exactly bind repository and revision",
        path: ["immutableIdentity"],
      })
    }

    const deploymentEligible = ["APPROVED", "ACTIVE", "FALLBACK"].includes(model.admission)
    if (
      deploymentEligible &&
      (model.license.commercialUse !== "ALLOWED" ||
        model.license.redistribution !== "ALLOWED")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Deployment-eligible model admission requires license evidence that explicitly allows commercial use and redistribution",
        path: ["license"],
      })
    }

    const capabilityEligible = model.admission === "ACTIVE" || model.admission === "FALLBACK"
    if (capabilityEligible && !model.admissionEvidence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ACTIVE and FALLBACK models require exact PROVEN capability evidence binding",
        path: ["admissionEvidence"],
      })
    }
    if (
      model.admissionEvidence &&
      model.admissionEvidence.modelImmutableIdentity !== model.immutableIdentity
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Admission evidence must bind the exact model immutable identity",
        path: ["admissionEvidence", "modelImmutableIdentity"],
      })
    }
  })

const RuntimeArtifactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("CONTAINER_IMAGE"),
      imageDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("NATIVE_BINARY"),
      binaryDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("PROVIDER_MANAGED"),
      serviceRevision: ImmutableRevisionSchema,
    })
    .strict(),
])

export const RuntimeIdentitySchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "OLLAMA",
      "LLAMA_CPP",
      "VLLM",
      "HERMES_AGENT",
      "EXTERNAL_API",
      "SPECIALIST",
    ]),
    version: ImmutableRevisionSchema,
    buildIdentity: NonEmptyStringSchema.optional(),
    artifact: RuntimeArtifactSchema,
    endpointClass: z.enum(["OPENAI_COMPATIBLE", "NATIVE", "CLI", "INTERNAL"]).optional(),
    lifecycle: z.enum([
      "UNKNOWN",
      "OFFLINE",
      "STARTING",
      "HEALTHY",
      "DEGRADED",
      "FAILED",
      "STOPPING",
    ]),
    observedAt: TimestampSchema.optional(),
    features: z.array(IdentifierSchema).min(1),
  })
  .strict()

export const RuntimeCapabilitySchema = z
  .object({
    runtimeId: IdentifierSchema,
    runtimeVersion: ImmutableRevisionSchema,
    hardwarePlatform: IdentifierSchema,
    feature: IdentifierSchema,
    verdict: z.enum([
      "UNKNOWN",
      "SUPPORTED",
      "MEASURED",
      "PROVEN",
      "DEGRADED",
      "FAILED",
      "UNAVAILABLE",
    ]),
    evidenceRef: NonEmptyStringSchema.optional(),
    observedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((capability, context) => {
    if (["MEASURED", "PROVEN", "DEGRADED", "FAILED"].includes(capability.verdict)) {
      if (!capability.evidenceRef || !capability.observedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Measured runtime capability verdicts require evidence and observation time",
          path: ["evidenceRef"],
        })
      }
    }
  })

export const ComputeIdentitySchema = z
  .object({
    id: IdentifierSchema,
    nodeId: IdentifierSchema.optional(),
    providerId: IdentifierSchema.optional(),
    providerResourceId: IdentifierSchema.optional(),
    placement: z.enum([
      "LOCAL_HOST",
      "LOCAL_FABRIC",
      "PRIVATE_REMOTE",
      "PROVIDER_MANAGED",
    ]),
    trustClass: IdentifierSchema,
    health: z.enum([
      "UNKNOWN",
      "AVAILABLE",
      "RESERVED",
      "DEGRADED",
      "DRAINING",
      "UNAVAILABLE",
      "DESTROYED",
    ]),
    lifecycle: z.enum([
      "UNKNOWN",
      "OFFLINE",
      "AVAILABLE",
      "RESERVED",
      "DEGRADED",
      "DRAINING",
      "FAILED",
      "DESTROYED",
    ]),
    hardwareDisclosure: z.enum([
      "ATTESTED",
      "SELF_REPORTED",
      "PROVIDER_UNDISCLOSED",
    ]),
    accelerators: z.array(
      z
        .object({
          uuid: IdentifierSchema,
          class: IdentifierSchema,
          vendor: NonEmptyStringSchema,
          model: NonEmptyStringSchema,
          vramBytes: PositiveIntegerSchema,
        })
        .strict(),
    ),
    cpu: z
      .object({
        logicalCores: z.number().int().positive().optional(),
        architecture: NonEmptyStringSchema.optional(),
      })
      .strict()
      .optional(),
    systemMemoryBytes: PositiveIntegerSchema.optional(),
    storageClass: IdentifierSchema.optional(),
    networkClass: IdentifierSchema.optional(),
    expiresAt: TimestampSchema.optional(),
    observedAt: TimestampSchema,
  })
  .strict()
  .superRefine((compute, context) => {
    if (compute.hardwareDisclosure === "PROVIDER_UNDISCLOSED" && compute.accelerators.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Undisclosed provider hardware cannot contain asserted accelerator identities",
        path: ["accelerators"],
      })
    }

    if (compute.hardwareDisclosure !== "PROVIDER_UNDISCLOSED" && compute.accelerators.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disclosed accelerator compute requires at least one exact accelerator identity",
        path: ["accelerators"],
      })
    }
  })

export const ResourceCapacitySchema = z
  .object({
    computeResourceId: IdentifierSchema,
    totalAcceleratorMemoryBytes: z.number().int().nonnegative(),
    reservedWeightBytes: z.number().int().nonnegative(),
    reservedKvBytes: z.number().int().nonnegative(),
    reservedRuntimeOverheadBytes: z.number().int().nonnegative(),
    totalSystemMemoryBytes: z.number().int().nonnegative(),
    reservedSystemMemoryBytes: z.number().int().nonnegative(),
    totalCpuLogicalCores: z.number().int().nonnegative(),
    reservedCpuLogicalCores: z.number().int().nonnegative(),
    currentReservationIds: z.array(IdentifierSchema),
    modelResidencyAllocations: z.array(
      z
        .object({
          modelArtifactId: IdentifierSchema,
          weightBytes: z.number().int().nonnegative(),
          kvBytes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    observedAt: TimestampSchema,
  })
  .strict()
  .superRefine((capacity, context) => {
    const reservedAcceleratorBytes =
      capacity.reservedWeightBytes +
      capacity.reservedKvBytes +
      capacity.reservedRuntimeOverheadBytes
    if (reservedAcceleratorBytes > capacity.totalAcceleratorMemoryBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reserved weight, KV, and runtime memory cannot exceed accelerator capacity",
        path: ["totalAcceleratorMemoryBytes"],
      })
    }
    if (capacity.reservedSystemMemoryBytes > capacity.totalSystemMemoryBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reserved system memory cannot exceed physical system memory",
        path: ["reservedSystemMemoryBytes"],
      })
    }
    if (capacity.reservedCpuLogicalCores > capacity.totalCpuLogicalCores) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reserved CPU cores cannot exceed available logical cores",
        path: ["reservedCpuLogicalCores"],
      })
    }
    const residentWeightBytes = capacity.modelResidencyAllocations.reduce(
      (total, allocation) => total + allocation.weightBytes,
      0,
    )
    const residentKvBytes = capacity.modelResidencyAllocations.reduce(
      (total, allocation) => total + allocation.kvBytes,
      0,
    )
    if (residentWeightBytes > capacity.reservedWeightBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model residency weight allocations cannot exceed reserved weight memory",
        path: ["modelResidencyAllocations"],
      })
    }
    if (residentKvBytes > capacity.reservedKvBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Model residency KV allocations cannot exceed reserved KV memory",
        path: ["modelResidencyAllocations"],
      })
    }
  })

export const PROVIDER_CLASSES = [
  "RESIDENT_LOCAL",
  "MANAGED_OPEN",
  "ELASTIC_OPEN",
  "BROKERED",
  "DIRECT_FRONTIER",
] as const

export const ProviderClassSchema = z.enum(PROVIDER_CLASSES)

export const ProviderIdentitySchema = z
  .object({
    id: IdentifierSchema,
    class: ProviderClassSchema,
    serviceIdentity: NonEmptyStringSchema,
    trustClass: IdentifierSchema,
    admission: z.enum(["UNADMITTED", "CANDIDATE", "APPROVED", "SUSPENDED", "RETIRED"]),
  })
  .strict()

export const DATA_CLASSES = ["S0", "S1", "S2", "S3", "S4"] as const
export const DataClassSchema = z.enum(DATA_CLASSES)

const EgressPermissionSchema = z.enum([
  "DENIED",
  "LOCAL_ONLY",
  "APPROVED_PRIVATE_REMOTE",
  "APPROVED_EXTERNAL_MODEL_API",
])

export const EgressPolicySchema = z
  .object({
    id: IdentifierSchema,
    schemaVersion: PositiveIntegerSchema,
    dataClass: DataClassSchema,
    prompts: EgressPermissionSchema,
    retrievedDocuments: EgressPermissionSchema,
    generatedEmbeddings: EgressPermissionSchema,
    kvCacheState: EgressPermissionSchema,
    logsAndTraces: EgressPermissionSchema,
    modelArtifacts: EgressPermissionSchema,
    telemetry: EgressPermissionSchema,
    toolAndNetworkAccess: EgressPermissionSchema,
    authorityRef: NonEmptyStringSchema,
    policyDigest: DigestSchema,
  })
  .strict()

export const ContextPackageSchema = z
  .object({
    id: IdentifierSchema,
    schemaVersion: PositiveIntegerSchema,
    projectId: IdentifierSchema.optional(),
    threadId: IdentifierSchema.optional(),
    workOrderRef: IdentifierSchema.optional(),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
    authorityRef: NonEmptyStringSchema.optional(),
    classification: DataClassSchema,
    includedSections: z
      .array(
        z
          .object({
            kind: IdentifierSchema,
            sourceRef: NonEmptyStringSchema,
            digest: DigestSchema,
          })
          .strict(),
      )
      .min(1),
    excludedClasses: z.array(NonEmptyStringSchema),
    compressionSteps: z.array(
      z
        .object({
          kind: IdentifierSchema,
          inputDigest: DigestSchema,
          outputDigest: DigestSchema,
          evidenceRef: NonEmptyStringSchema.optional(),
        })
        .strict(),
    ),
    provenance: z
      .array(
        z
          .object({
            sourceRef: NonEmptyStringSchema,
            sourceDigest: DigestSchema,
            selectedBy: IdentifierSchema,
          })
          .strict(),
      )
      .min(1),
    estimatedTokens: z.number().int().nonnegative().optional(),
    digest: DigestSchema,
    compiledAt: TimestampSchema,
  })
  .strict()

export const ContextReferenceSchema = z
  .object({
    packageId: IdentifierSchema,
    schemaVersion: PositiveIntegerSchema,
    digest: DigestSchema,
    classification: DataClassSchema,
    projectId: IdentifierSchema.optional(),
    threadId: IdentifierSchema.optional(),
    workOrderRef: IdentifierSchema.optional(),
    sourceRefs: z.array(NonEmptyStringSchema).min(1),
  })
  .strict()

export const InferenceRequestEnvelopeSchema = z
  .object({
    id: IdentifierSchema,
    schemaVersion: PositiveIntegerSchema,
    workRef: IdentifierSchema,
    dataClass: DataClassSchema,
    capability: z
      .object({
        id: IdentifierSchema,
        version: NonEmptyStringSchema,
      })
      .strict(),
    requiredCapabilities: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            version: NonEmptyStringSchema,
          })
          .strict(),
      )
      .min(1),
    requestedModel: ModelIdentitySchema.optional(),
    preferredCapabilities: z.array(IdentifierSchema),
    modalities: z
      .array(
        z.enum([
          "TEXT",
          "IMAGE",
          "AUDIO",
          "VIDEO",
          "DOCUMENT",
          "EMBEDDING",
          "RERANK",
          "STRUCTURED_DATA",
        ]),
      )
      .min(1),
    minimumContextTokens: PositiveIntegerSchema.optional(),
    allowedProviderClasses: z.array(ProviderClassSchema).min(1),
    allowedExecutionClasses: z
      .array(z.enum(["LOCAL", "PRIVATE_REMOTE", "EXTERNAL_MODEL_API"]))
      .min(1),
    context: ContextReferenceSchema,
    egressPolicyId: IdentifierSchema,
    tools: z.array(
      z
        .object({
          id: IdentifierSchema,
          authorityRef: NonEmptyStringSchema,
        })
        .strict(),
    ),
    limits: z
      .object({
        maxCostUsd: FiniteNonNegativeSchema,
        maxLatencyMs: PositiveIntegerSchema,
      })
      .strict(),
    priority: z.enum(["REALTIME", "INTERACTIVE", "NORMAL", "BACKGROUND", "MAINTENANCE"]),
    qualityTarget: NonEmptyStringSchema.optional(),
    continuity: z.enum(["STATELESS", "THREAD"]),
    fallbackAllowed: z.boolean(),
    fallbackPolicy: z
      .object({
        allowed: z.boolean(),
        maxRetries: z.number().int().nonnegative(),
        allowedFailureClasses: z.array(IdentifierSchema),
        preserveDataClass: z.literal(true),
      })
      .strict(),
    toolAuthorityRef: NonEmptyStringSchema.optional(),
    authority: z
      .object({
        authorityRef: NonEmptyStringSchema,
        policyDigest: DigestSchema,
        allowedActions: z.array(IdentifierSchema).min(1),
        expiresAt: TimestampSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.context.classification !== request.dataClass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Context classification must exactly match the request data class",
        path: ["context", "classification"],
      })
    }
    if (
      !request.requiredCapabilities.some(
        (capability) =>
          capability.id === request.capability.id &&
          capability.version === request.capability.version,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Primary capability must be present in requiredCapabilities",
        path: ["requiredCapabilities"],
      })
    }
    if (request.fallbackAllowed !== request.fallbackPolicy.allowed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallbackAllowed and fallbackPolicy.allowed must agree",
        path: ["fallbackPolicy", "allowed"],
      })
    }
    if (!request.fallbackAllowed && request.fallbackPolicy.maxRetries !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fallback-disabled requests must have a zero retry budget",
        path: ["fallbackPolicy", "maxRetries"],
      })
    }
  })

export const PlacementSelectionSchema = z
  .object({
    workerLaneId: IdentifierSchema.optional(),
    provider: ProviderIdentitySchema,
    model: ModelIdentitySchema,
    runtime: RuntimeIdentitySchema,
    runtimeConfigurationDigest: DigestSchema,
    compute: ComputeIdentitySchema,
    executionClass: z.enum(["LOCAL", "PRIVATE_REMOTE", "EXTERNAL_MODEL_API"]),
  })
  .strict()

export const PlacementDecisionSchema = z
  .object({
    id: IdentifierSchema,
    requestId: IdentifierSchema,
    requirementId: IdentifierSchema,
    contextPackageId: IdentifierSchema,
    considered: z
      .array(
        z
          .object({
            candidateId: IdentifierSchema,
            eligible: z.boolean(),
            refusals: z.array(IdentifierSchema),
            score: z.number().finite().optional(),
            evidenceRefs: z.array(NonEmptyStringSchema),
          })
          .strict()
          .superRefine((candidate, context) => {
            if (candidate.eligible && candidate.refusals.length > 0) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "An eligible candidate cannot retain hard-gate refusals",
                path: ["refusals"],
              })
            }
            if (!candidate.eligible && candidate.refusals.length === 0) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "An ineligible candidate requires at least one typed refusal",
                path: ["refusals"],
              })
            }
          }),
      )
      .min(1),
    selected: PlacementSelectionSchema,
    fallbackCandidateIds: z.array(IdentifierSchema),
    policyDigest: DigestSchema,
    reason: NonEmptyStringSchema,
    decidedAt: TimestampSchema,
  })
  .strict()

export const RESERVATION_STATES = [
  "REQUESTED",
  "ACTIVE",
  "PREEMPTING",
  "RELEASED",
  "EXPIRED",
  "FAILED",
] as const

export type ReservationState = (typeof RESERVATION_STATES)[number]

const reservationTargets = (...states: ReservationState[]): readonly ReservationState[] =>
  Object.freeze(states)

export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationState, readonly ReservationState[]>
> = Object.freeze({
  REQUESTED: reservationTargets("ACTIVE", "EXPIRED", "FAILED"),
  ACTIVE: reservationTargets("PREEMPTING", "RELEASED", "EXPIRED", "FAILED"),
  PREEMPTING: reservationTargets("RELEASED", "EXPIRED", "FAILED"),
  RELEASED: reservationTargets(),
  EXPIRED: reservationTargets(),
  FAILED: reservationTargets(),
})

export function isValidReservationTransition(
  from: ReservationState,
  to: ReservationState,
): boolean {
  return RESERVATION_TRANSITIONS[from].includes(to)
}

export const AcceleratorReservationSchema = z
  .object({
    id: IdentifierSchema,
    requestId: IdentifierSchema,
    computeResourceId: IdentifierSchema,
    workRef: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    modelArtifactId: IdentifierSchema.optional(),
    requestedWeightBytes: z.number().int().nonnegative(),
    requestedKvBytes: z.number().int().nonnegative(),
    requestedRuntimeOverheadBytes: z.number().int().nonnegative(),
    requestedSystemMemoryBytes: z.number().int().nonnegative(),
    priority: z.enum(["REALTIME", "INTERACTIVE", "NORMAL", "BACKGROUND", "MAINTENANCE"]),
    preemptible: z.boolean(),
    fencingToken: PositiveIntegerSchema,
    leaseExpiresAt: TimestampSchema,
    state: z.enum(RESERVATION_STATES),
  })
  .strict()

export const InferenceExecutionSchema = z
  .object({
    id: IdentifierSchema,
    requestId: IdentifierSchema,
    requirementId: IdentifierSchema,
    placementDecisionId: IdentifierSchema,
    contextPackageId: IdentifierSchema,
    reservationId: IdentifierSchema.optional(),
    parentExecutionId: IdentifierSchema.optional(),
    state: z.enum([
      "QUEUED",
      "LOADING",
      "RUNNING",
      "VALIDATING",
      "COMPLETED",
      "WAITING",
      "FAILED",
      "CANCELLED",
    ]),
    failureClass: z
      .enum([
        "MODEL_LOAD_FAILED",
        "MODEL_OOM",
        "KV_CAPACITY_EXHAUSTED",
        "CONTEXT_TOO_LARGE",
        "RUNTIME_UNHEALTHY",
        "ACCELERATOR_UNAVAILABLE",
        "CAPABILITY_UNPROVEN",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_AUTH_FAILED",
        "CLOUD_CAPACITY_UNAVAILABLE",
        "BUDGET_EXCEEDED",
        "POLICY_DENIED_REMOTE",
        "MODEL_OUTPUT_INVALID",
        "TOOL_CALL_FAILED",
        "QUALITY_GATE_FAILED",
        "ELASTIC_IDENTITY_FAILED",
        "ELASTIC_WIPE_FAILED",
        "ELASTIC_DESTROY_FAILED",
      ])
      .optional(),
    startedAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
    metrics: z.record(z.union([z.number().finite(), z.string(), z.boolean(), z.null()])),
    toolEvidenceRefs: z.array(NonEmptyStringSchema),
    resultEvidenceRef: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((execution, context) => {
    if (execution.state === "FAILED" && !execution.failureClass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "FAILED inference execution requires a typed failure class",
        path: ["failureClass"],
      })
    }
    if (execution.state !== "FAILED" && execution.failureClass) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failure class is only valid for FAILED inference execution",
        path: ["failureClass"],
      })
    }
    if (
      execution.startedAt &&
      execution.finishedAt &&
      Date.parse(execution.finishedAt) < Date.parse(execution.startedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inference execution cannot finish before it starts",
        path: ["finishedAt"],
      })
    }
  })

export const CapabilityEvaluationSchema = z
  .object({
    id: IdentifierSchema,
    capabilityId: IdentifierSchema,
    capabilityVersion: NonEmptyStringSchema,
    model: ModelIdentitySchema,
    runtime: RuntimeIdentitySchema,
    runtimeConfigurationDigest: DigestSchema,
    computeClass: IdentifierSchema,
    verdict: z.enum([
      "UNKNOWN",
      "SUPPORTED",
      "MEASURED",
      "PROVEN",
      "DEGRADED",
      "FAILED",
      "RETIRED",
    ]),
    evidenceRef: NonEmptyStringSchema,
    measuredAt: TimestampSchema,
    metrics: z.record(z.union([z.number().finite(), z.string(), z.boolean(), z.null()])),
    measuredBy: IdentifierSchema,
    promotedBy: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.verdict === "PROVEN" && !evaluation.promotedBy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PROVEN capability evidence requires a separate promotion identity",
        path: ["promotedBy"],
      })
    }
    if (evaluation.promotedBy && evaluation.promotedBy === evaluation.measuredBy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Capability evidence may not self-promote",
        path: ["promotedBy"],
      })
    }
  })

export const ELASTIC_WORKER_STATES = [
  "REQUESTED",
  "PROVISIONING",
  "ATTESTING",
  "READY",
  "RESERVED",
  "EXECUTING",
  "SETTLING",
  "WIPING",
  "DESTROYING",
  "DESTROYED",
  "FAILED",
] as const

export type ElasticWorkerState = (typeof ELASTIC_WORKER_STATES)[number]

const elasticWorkerTargets = (...states: ElasticWorkerState[]): readonly ElasticWorkerState[] =>
  Object.freeze(states)

export const ELASTIC_WORKER_TRANSITIONS: Readonly<
  Record<ElasticWorkerState, readonly ElasticWorkerState[]>
> = Object.freeze({
  REQUESTED: elasticWorkerTargets("PROVISIONING", "FAILED"),
  PROVISIONING: elasticWorkerTargets("ATTESTING", "FAILED"),
  ATTESTING: elasticWorkerTargets("READY", "FAILED"),
  READY: elasticWorkerTargets("RESERVED", "DESTROYING", "FAILED"),
  RESERVED: elasticWorkerTargets("EXECUTING", "SETTLING", "FAILED"),
  EXECUTING: elasticWorkerTargets("SETTLING", "FAILED"),
  SETTLING: elasticWorkerTargets("WIPING", "FAILED"),
  WIPING: elasticWorkerTargets("DESTROYING", "FAILED"),
  DESTROYING: elasticWorkerTargets("DESTROYED", "FAILED"),
  DESTROYED: elasticWorkerTargets(),
  FAILED: elasticWorkerTargets("WIPING", "DESTROYING"),
})

export function isValidElasticWorkerTransition(
  from: ElasticWorkerState,
  to: ElasticWorkerState,
): boolean {
  return ELASTIC_WORKER_TRANSITIONS[from].includes(to)
}

export const ElasticWorkerSchema = z
  .object({
    id: IdentifierSchema,
    provider: ProviderIdentitySchema,
    computeResourceId: IdentifierSchema,
    workRef: IdentifierSchema,
    state: z.enum(ELASTIC_WORKER_STATES),
    shortLivedIdentityRef: NonEmptyStringSchema.optional(),
    provisionEvidenceRef: NonEmptyStringSchema.optional(),
    wipeEvidenceRef: NonEmptyStringSchema.optional(),
    destructionEvidenceRef: NonEmptyStringSchema.optional(),
    maxCostUsd: FiniteNonNegativeSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .superRefine((worker, context) => {
    if (worker.provider.class !== "ELASTIC_OPEN") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Elastic workers require an ELASTIC_OPEN provider",
        path: ["provider", "class"],
      })
    }
    if (worker.state === "DESTROYED" && !worker.destructionEvidenceRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DESTROYED requires destruction evidence",
        path: ["destructionEvidenceRef"],
      })
    }
  })

const TokenUsageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict()
  .refine(({ input, output, total }) => total === input + output, {
    message: "Total tokens must equal input plus output tokens",
    path: ["total"],
  })

const LatencySchema = z
  .object({
    queueMs: z.number().int().nonnegative(),
    timeToFirstTokenMs: z.number().int().nonnegative(),
    inferenceMs: z.number().int().nonnegative(),
    totalMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    ({ queueMs, inferenceMs, totalMs }) => totalMs >= queueMs + inferenceMs,
    { message: "Total latency must cover queue and inference latency", path: ["totalMs"] },
  )

const CostSchema = z
  .object({
    amount: FiniteNonNegativeSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()

const ModelRedirectionSchema = z
  .object({
    kind: z.literal("EXPLICIT_REVISION_REDIRECT"),
    fromImmutableIdentity: IdentifierSchema,
    fromRevision: NonEmptyStringSchema,
    toImmutableIdentity: IdentifierSchema,
    toRevision: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    authorityRef: NonEmptyStringSchema,
    evidenceRef: NonEmptyStringSchema,
  })
  .strict()

const FallbackReceiptSchema = z
  .object({
    attempt: PositiveIntegerSchema,
    failureClass: IdentifierSchema,
    fromProvider: ProviderIdentitySchema,
    fromModel: ModelIdentitySchema,
    toProvider: ProviderIdentitySchema,
    toModel: ModelIdentitySchema,
    placementDecisionId: IdentifierSchema,
    occurredAt: TimestampSchema,
  })
  .strict()

type ExactProviderIdentity = z.infer<typeof ProviderIdentitySchema>
type ExactModelIdentity = z.infer<typeof ModelIdentitySchema>

function hasSameExactProvider(
  left: ExactProviderIdentity,
  right: ExactProviderIdentity,
): boolean {
  return (
    left.id === right.id &&
    left.class === right.class &&
    left.serviceIdentity === right.serviceIdentity &&
    left.trustClass === right.trustClass &&
    left.admission === right.admission
  )
}

function hasSameExactModel(left: ExactModelIdentity, right: ExactModelIdentity): boolean {
  // Both operands have already been parsed by the same strict schema, which emits
  // keys deterministically. Comparing the normalized representation covers all
  // identity, provenance, license, quantization, context, trust and admission fields.
  return JSON.stringify(left) === JSON.stringify(right)
}

export const InferenceReceiptSchema = z
  .object({
    id: IdentifierSchema,
    schemaVersion: PositiveIntegerSchema,
    requestId: IdentifierSchema,
    placementDecisionId: IdentifierSchema,
    context: ContextReferenceSchema,
    exportedContextDigest: DigestSchema,
    requestedModel: ModelIdentitySchema,
    actualModel: ModelIdentitySchema,
    modelRedirection: ModelRedirectionSchema.optional(),
    requestedProvider: ProviderIdentitySchema,
    actualProvider: ProviderIdentitySchema,
    actualPlacement: PlacementSelectionSchema,
    reservationId: IdentifierSchema.optional(),
    tokenUsage: TokenUsageSchema,
    latency: LatencySchema,
    cost: CostSchema,
    retryCount: z.number().int().nonnegative(),
    fallbackHistory: z.array(FallbackReceiptSchema),
    evaluation: z
      .object({
        evaluationId: IdentifierSchema,
        verdict: z.enum(["PASS", "FAIL", "NOT_RUN"]),
        evidenceRef: NonEmptyStringSchema.optional(),
      })
      .strict()
      .superRefine((evaluation, context) => {
        if (evaluation.verdict !== "NOT_RUN" && !evaluation.evidenceRef) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A completed evaluation requires evidence",
            path: ["evidenceRef"],
          })
        }
      }),
    outputHash: DigestSchema,
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const modelChanged =
      receipt.requestedModel.immutableIdentity !== receipt.actualModel.immutableIdentity ||
      receipt.requestedModel.revision !== receipt.actualModel.revision

    if (modelChanged && !receipt.modelRedirection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A model revision or immutable identity change requires an explicit redirect record",
        path: ["modelRedirection"],
      })
    }

    if (!modelChanged && receipt.modelRedirection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A model redirect record is forbidden when requested and actual identity are equal",
        path: ["modelRedirection"],
      })
    }

    if (receipt.modelRedirection) {
      const redirect = receipt.modelRedirection
      const redirectMatches =
        redirect.fromImmutableIdentity === receipt.requestedModel.immutableIdentity &&
        redirect.fromRevision === receipt.requestedModel.revision &&
        redirect.toImmutableIdentity === receipt.actualModel.immutableIdentity &&
        redirect.toRevision === receipt.actualModel.revision
      if (!redirectMatches) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Model redirect endpoints must exactly match requested and actual model identities",
          path: ["modelRedirection"],
        })
      }
    }

    if (!hasSameExactProvider(receipt.actualPlacement.provider, receipt.actualProvider)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Actual placement provider must exactly match the complete actual provider identity",
        path: ["actualPlacement", "provider"],
      })
    }
    if (!hasSameExactModel(receipt.actualPlacement.model, receipt.actualModel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Actual placement model must exactly match the complete actual model identity",
        path: ["actualPlacement", "model"],
      })
    }
    if (receipt.retryCount !== receipt.fallbackHistory.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Retry count must exactly equal the recorded fallback attempt count",
        path: ["retryCount"],
      })
    }

    let expectedProvider = receipt.requestedProvider
    let expectedModel = receipt.requestedModel
    receipt.fallbackHistory.forEach((fallback, index) => {
      if (fallback.attempt !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Fallback attempts must be consecutively numbered from one",
          path: ["fallbackHistory", index, "attempt"],
        })
      }
      if (
        !hasSameExactProvider(fallback.fromProvider, expectedProvider) ||
        !hasSameExactModel(fallback.fromModel, expectedModel)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Fallback history must form a contiguous exact provider and model chain",
          path: ["fallbackHistory", index],
        })
      }
      expectedProvider = fallback.toProvider
      expectedModel = fallback.toModel
    })

    if (
      !hasSameExactProvider(expectedProvider, receipt.actualProvider) ||
      !hasSameExactModel(expectedModel, receipt.actualModel)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fallback history must terminate at the exact actual provider and model pair",
        path: ["fallbackHistory"],
      })
    }
    if (Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inference cannot finish before it starts",
        path: ["finishedAt"],
      })
    }
  })

export type IntelligenceCapability = z.infer<typeof IntelligenceCapabilitySchema>
export type ModelIdentity = z.infer<typeof ModelIdentitySchema>
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>
export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>
export type ComputeIdentity = z.infer<typeof ComputeIdentitySchema>
export type ResourceCapacity = z.infer<typeof ResourceCapacitySchema>
export type ProviderIdentity = z.infer<typeof ProviderIdentitySchema>
export type EgressPolicy = z.infer<typeof EgressPolicySchema>
export type ContextPackage = z.infer<typeof ContextPackageSchema>
export type ContextReference = z.infer<typeof ContextReferenceSchema>
export type InferenceRequestEnvelope = z.infer<typeof InferenceRequestEnvelopeSchema>
export type PlacementDecision = z.infer<typeof PlacementDecisionSchema>
export type AcceleratorReservation = z.infer<typeof AcceleratorReservationSchema>
export type InferenceExecution = z.infer<typeof InferenceExecutionSchema>
export type CapabilityEvaluation = z.infer<typeof CapabilityEvaluationSchema>
export type ElasticWorker = z.infer<typeof ElasticWorkerSchema>
export type InferenceReceipt = z.infer<typeof InferenceReceiptSchema>
