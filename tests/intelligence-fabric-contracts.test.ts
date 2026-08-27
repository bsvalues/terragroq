import { describe, expect, it } from "vitest"
import {
  AcceleratorReservationSchema,
  CapabilityEvaluationSchema,
  ComputeIdentitySchema,
  ContextPackageSchema,
  DATA_CLASSES,
  EgressPolicySchema,
  ELASTIC_WORKER_STATES,
  ELASTIC_WORKER_TRANSITIONS,
  ElasticWorkerSchema,
  InferenceReceiptSchema,
  InferenceExecutionSchema,
  InferenceRequestEnvelopeSchema,
  IntelligenceCapabilitySchema,
  ImmutableRevisionSchema,
  ModelIdentitySchema,
  PlacementDecisionSchema,
  PROVIDER_CLASSES,
  RESERVATION_STATES,
  RESERVATION_TRANSITIONS,
  ResourceCapacitySchema,
  RuntimeCapabilitySchema,
  isValidElasticWorkerTransition,
  isValidReservationTransition,
  type ElasticWorkerState,
  type ReservationState,
} from "@/components/operator/intelligence-fabric-contracts"

const digest = (character: string) => `sha256:${character.repeat(64)}`
const timestamp = "2026-08-27T16:00:00.000Z"

function model(overrides: Record<string, unknown> = {}) {
  const repository =
    typeof overrides.repository === "string"
      ? overrides.repository
      : "huggingface://Qwen/Qwen3-4B"
  const revision =
    typeof overrides.revision === "string"
      ? overrides.revision
      : "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
  const immutableIdentity =
    typeof overrides.immutableIdentity === "string"
      ? overrides.immutableIdentity
      : `${repository}@${revision}`

  return {
    id: "model.qwen3-4b-64k",
    family: "Qwen3",
    repository,
    source: repository,
    revision,
    immutableIdentity,
    alias: "williamos-qwen3-4b:64k",
    artifactDigest: digest("a"),
    architecture: "qwen3",
    modalities: ["TEXT"],
    license: {
      id: "Apache-2.0",
      evidenceRef: "evidence://license/qwen3",
      commercialUse: "ALLOWED",
      redistribution: "ALLOWED",
    },
    quantization: {
      disclosure: "DISCLOSED",
      format: "Q4_K_M",
      bits: 4,
    },
    context: {
      maxInputTokens: 61_440,
      maxOutputTokens: 4_096,
      maxTotalTokens: 65_536,
    },
    sourceTrust: "APPROVED",
    admission: "ACTIVE",
    admissionEvidence: {
      kind: "CAPABILITY_EVIDENCE_BINDING",
      modelImmutableIdentity: immutableIdentity,
      capability: { id: "capability.governed-code", version: "1" },
      runtime: { id: "runtime.evaluated", version: "1.0.0" },
      runtimeConfigurationDigest: digest("8"),
      computeClass: "NVIDIA_PASCAL_24GB",
      evaluationId: "evaluation.model-admission.1",
      verdict: "PROVEN",
      evidenceRef: "evidence://model-admission/1",
      measuredAt: timestamp,
      promotedBy: "agent.independent-reviewer",
    },
    createdAt: timestamp,
    ...overrides,
  }
}

function provider(providerClass: (typeof PROVIDER_CLASSES)[number]) {
  return {
    id: `provider.${providerClass.toLowerCase()}`,
    class: providerClass,
    serviceIdentity: `WilliamOS ${providerClass}`,
    trustClass: providerClass === "RESIDENT_LOCAL" ? "SOVEREIGN_LOCAL" : "REMOTE_APPROVED",
    admission: "APPROVED",
  }
}

function localRuntime() {
  return {
    id: "runtime.hermes-ollama",
    kind: "OLLAMA",
    version: "0.9.2",
    buildIdentity: "ollama-windows-amd64-0.9.2",
    artifact: {
      kind: "NATIVE_BINARY",
      binaryDigest: digest("b"),
    },
    endpointClass: "OPENAI_COMPATIBLE",
    lifecycle: "HEALTHY",
    observedAt: timestamp,
    features: ["openai-compatible", "structured-output", "tool-passthrough"],
  }
}

function remoteRuntime(providerClass: (typeof PROVIDER_CLASSES)[number]) {
  if (providerClass === "ELASTIC_OPEN") {
    return {
      id: "runtime.elastic-vllm",
      kind: "VLLM",
      version: "0.10.1",
      buildIdentity: "vllm-0.10.1-cuda",
      artifact: {
        kind: "CONTAINER_IMAGE",
        imageDigest: digest("c"),
      },
      endpointClass: "OPENAI_COMPATIBLE",
      lifecycle: "HEALTHY",
      observedAt: timestamp,
      features: ["openai-compatible", "structured-output"],
    }
  }

  return {
    id: `runtime.${providerClass.toLowerCase()}-api`,
    kind: "EXTERNAL_API",
    version: "2026-08-27",
    artifact: {
      kind: "PROVIDER_MANAGED",
      serviceRevision: "2026-08-27",
    },
    endpointClass: "OPENAI_COMPATIBLE",
    lifecycle: "HEALTHY",
    observedAt: timestamp,
    features: ["openai-compatible", "structured-output"],
  }
}

function localCompute() {
  return {
    id: "compute.hermes-p40",
    nodeId: "node.hermes",
    placement: "LOCAL_FABRIC",
    trustClass: "SOVEREIGN_LOCAL",
    health: "AVAILABLE",
    lifecycle: "AVAILABLE",
    hardwareDisclosure: "ATTESTED",
    accelerators: [
      {
        uuid: "GPU-11111111-2222-3333-4444-555555555555",
        class: "NVIDIA_PASCAL",
        vendor: "NVIDIA",
        model: "Tesla P40",
        vramBytes: 25_769_803_776,
      },
    ],
    observedAt: timestamp,
  }
}

function remoteCompute(providerClass: (typeof PROVIDER_CLASSES)[number]) {
  if (providerClass === "ELASTIC_OPEN") {
    return {
      id: "compute.elastic-h100",
      providerResourceId: "resource.runpod-123",
      placement: "PRIVATE_REMOTE",
      trustClass: "PRIVATE_EPHEMERAL_ATTESTED",
      health: "RESERVED",
      lifecycle: "RESERVED",
      hardwareDisclosure: "ATTESTED",
      accelerators: [
        {
          uuid: "GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          class: "NVIDIA_HOPPER",
          vendor: "NVIDIA",
          model: "H100",
          vramBytes: 85_899_345_920,
        },
      ],
      observedAt: timestamp,
    }
  }

  return {
    id: `compute.${providerClass.toLowerCase()}-managed`,
    providerResourceId: `service.${providerClass.toLowerCase()}`,
    placement: "PROVIDER_MANAGED",
    trustClass: "REMOTE_APPROVED",
    health: "AVAILABLE",
    lifecycle: "AVAILABLE",
    hardwareDisclosure: "PROVIDER_UNDISCLOSED",
    accelerators: [],
    observedAt: timestamp,
  }
}

function contextReference(dataClass: (typeof DATA_CLASSES)[number] = "S0") {
  return {
    packageId: "context.thread-964.1",
    schemaVersion: 1,
    digest: digest("d"),
    classification: dataClass,
    projectId: "project.intelligence-fabric",
    threadId: "thread.964",
    workOrderRef: "IF-01",
    sourceRefs: ["atlas://threads/964", "git://bsvalues/terragroq@0e4536e"],
  }
}

function receiptFor(providerClass: (typeof PROVIDER_CLASSES)[number]) {
  const actualProvider = provider(providerClass)
  const actualRuntime =
    providerClass === "RESIDENT_LOCAL" ? localRuntime() : remoteRuntime(providerClass)
  const actualCompute =
    providerClass === "RESIDENT_LOCAL" ? localCompute() : remoteCompute(providerClass)
  const actualModel =
    providerClass === "RESIDENT_LOCAL"
      ? model()
      : model({
          id: `model.${providerClass.toLowerCase()}-qwen3`,
          repository: `provider://${providerClass.toLowerCase()}/qwen3`,
          revision: "provider-version-2026-08-27",
          immutableIdentity: `provider://${providerClass.toLowerCase()}/qwen3@provider-version-2026-08-27`,
          alias: undefined,
          artifactDigest: undefined,
          quantization: { disclosure: "PROVIDER_UNDISCLOSED" },
        })

  return {
    id: `receipt.${providerClass.toLowerCase()}`,
    schemaVersion: 1,
    requestId: "request.if-01.1",
    placementDecisionId: "placement.if-01.1",
    context: contextReference("S0"),
    exportedContextDigest: digest("e"),
    requestedModel: actualModel,
    actualModel,
    requestedProvider: actualProvider,
    actualProvider,
    actualPlacement: {
      provider: actualProvider,
      model: actualModel,
      runtime: actualRuntime,
      runtimeConfigurationDigest: digest("7"),
      compute: actualCompute,
      executionClass:
        providerClass === "RESIDENT_LOCAL"
          ? "LOCAL"
          : providerClass === "ELASTIC_OPEN"
            ? "PRIVATE_REMOTE"
            : "EXTERNAL_MODEL_API",
    },
    reservationId:
      providerClass === "RESIDENT_LOCAL" || providerClass === "ELASTIC_OPEN"
        ? "reservation.if-01.1"
        : undefined,
    tokenUsage: { input: 900, output: 100, total: 1_000 },
    latency: {
      queueMs: 20,
      timeToFirstTokenMs: 60,
      inferenceMs: 500,
      totalMs: 540,
    },
    cost: {
      amount: providerClass === "RESIDENT_LOCAL" ? 0 : 0.0125,
      currency: "USD",
    },
    retryCount: 0,
    fallbackHistory: [],
    evaluation: {
      evaluationId: "evaluation.if-01.1",
      verdict: "PASS",
      evidenceRef: "evidence://evaluation/if-01/1",
    },
    outputHash: digest("f"),
    startedAt: timestamp,
    finishedAt: "2026-08-27T16:00:00.540Z",
  }
}

describe("Intelligence Fabric domain contracts", () => {
  it("keeps stable capability identity separate from exact model identity", () => {
    expect(
      IntelligenceCapabilitySchema.parse({
        id: "capability.governed-code",
        version: "1",
        name: "Governed repository implementation",
        modalities: ["TEXT", "DOCUMENT"],
        requiredFeatures: ["structured-output", "tool-passthrough"],
      }),
    ).toMatchObject({ id: "capability.governed-code" })

    expect(ModelIdentitySchema.parse(model())).toMatchObject({
      immutableIdentity:
        "huggingface://Qwen/Qwen3-4B@a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      revision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    })
  })

  it("accepts only immutable revision identities and binds them to repositories", () => {
    const immutableRevisions = [
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      digest("9"),
      "v2.4.1",
      "provider-version-2026-08-27",
      "claude-3-7-sonnet-20250219",
    ]
    for (const revision of immutableRevisions) {
      expect(ImmutableRevisionSchema.safeParse(revision).success, revision).toBe(true)
    }

    const mutableOrAmbiguousRevisions = [
      "latest",
      "main",
      "refs/heads/main",
      "heads/release-2",
      "branch:feature/model",
      "stable-2026",
      "gpt-4-preview",
      "nightly.20260827",
      "1.x",
      "1.2.*",
      "^1.2.3",
      "~1.2.3",
      ">=1.2.3",
      "1.2",
    ]
    for (const revision of mutableOrAmbiguousRevisions) {
      expect(ImmutableRevisionSchema.safeParse(revision).success, revision).toBe(false)
      expect(ModelIdentitySchema.safeParse(model({ revision })).success, revision).toBe(false)
    }

    expect(
      ModelIdentitySchema.safeParse({
        ...model(),
        immutableIdentity: "huggingface://Other/Repository@v1.0.0",
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...model(),
        context: { maxInputTokens: 100, maxOutputTokens: 100, maxTotalTokens: 100 },
      }).success,
    ).toBe(false)
  })

  it("fails closed on model license and capability-evidence admission invariants", () => {
    const exactActiveModel = model()

    expect(ModelIdentitySchema.safeParse(exactActiveModel).success).toBe(true)
    expect(
      ModelIdentitySchema.safeParse({ ...exactActiveModel, admission: "FALLBACK" }).success,
    ).toBe(true)

    for (const commercialUse of ["UNKNOWN", "DENIED"] as const) {
      expect(
        ModelIdentitySchema.safeParse({
          ...exactActiveModel,
          license: { ...exactActiveModel.license, commercialUse },
        }).success,
        `ACTIVE commercialUse=${commercialUse}`,
      ).toBe(false)
    }
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        license: { ...exactActiveModel.license, redistribution: "UNKNOWN" },
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admission: "APPROVED",
        license: { ...exactActiveModel.license, commercialUse: "UNKNOWN" },
        admissionEvidence: undefined,
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admissionEvidence: undefined,
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admissionEvidence: {
          ...exactActiveModel.admissionEvidence,
          modelImmutableIdentity: "huggingface://Other/Model@v1.0.0",
        },
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admissionEvidence: {
          ...exactActiveModel.admissionEvidence,
          runtime: { id: "runtime.evaluated", version: "latest" },
        },
      }).success,
    ).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admissionEvidence: {
          ...exactActiveModel.admissionEvidence,
          providerSdkBinding: {},
        },
      }).success,
    ).toBe(false)

    expect(
      ModelIdentitySchema.safeParse({
        ...exactActiveModel,
        admission: "DISCOVERED",
        admissionEvidence: undefined,
        license: {
          ...exactActiveModel.license,
          commercialUse: "UNKNOWN",
          redistribution: "UNKNOWN",
        },
      }).success,
    ).toBe(true)
  })

  it("validates all data classes in strict request envelopes", () => {
    for (const dataClass of DATA_CLASSES) {
      const result = InferenceRequestEnvelopeSchema.safeParse({
        id: `request.${dataClass.toLowerCase()}`,
        schemaVersion: 1,
        workRef: "IF-01",
        dataClass,
        capability: { id: "capability.governed-code", version: "1" },
        requiredCapabilities: [{ id: "capability.governed-code", version: "1" }],
        requestedModel: model(),
        preferredCapabilities: ["capability.fast-structured-output"],
        modalities: ["TEXT", "DOCUMENT"],
        minimumContextTokens: 32_768,
        allowedProviderClasses: [...PROVIDER_CLASSES],
        allowedExecutionClasses: ["LOCAL", "PRIVATE_REMOTE", "EXTERNAL_MODEL_API"],
        context: contextReference(dataClass),
        egressPolicyId: `egress.${dataClass.toLowerCase()}`,
        tools: [{ id: "tool.repository-read", authorityRef: "authority://if-01" }],
        limits: { maxCostUsd: 1.25, maxLatencyMs: 30_000 },
        priority: "NORMAL",
        qualityTarget: "governed-code-pass",
        continuity: "THREAD",
        fallbackAllowed: true,
        fallbackPolicy: {
          allowed: true,
          maxRetries: 2,
          allowedFailureClasses: ["RUNTIME_UNHEALTHY", "PROVIDER_RATE_LIMITED"],
          preserveDataClass: true,
        },
        toolAuthorityRef: "authority://if-01/tools",
        authority: {
          authorityRef: "authority://issue/964#if-01",
          policyDigest: digest("1"),
          allowedActions: ["schema-validate"],
          expiresAt: "2026-09-01T00:00:00.000Z",
        },
      })

      expect(result.success, dataClass).toBe(true)
    }
  })

  it("rejects unknown fields and contradictory compute disclosure", () => {
    expect(ModelIdentitySchema.safeParse({ ...model(), sdkModelObject: {} }).success).toBe(false)
    expect(
      ModelIdentitySchema.safeParse({
        ...model(),
        license: { ...model().license, providerTermsObject: {} },
      }).success,
    ).toBe(false)
    expect(
      ComputeIdentitySchema.safeParse({
        ...localCompute(),
        hardwareDisclosure: "PROVIDER_UNDISCLOSED",
      }).success,
    ).toBe(false)
  })

  it("represents local Ollama and every remote provider class without SDK types", () => {
    for (const providerClass of PROVIDER_CLASSES) {
      const parsed = InferenceReceiptSchema.parse(receiptFor(providerClass))

      expect(parsed.actualProvider.class).toBe(providerClass)
      expect(parsed.actualPlacement.provider.class).toBe(providerClass)
      expect(parsed.exportedContextDigest).toBe(digest("e"))
      expect(parsed.tokenUsage.total).toBe(1_000)
      expect(parsed.latency.totalMs).toBe(540)
      expect(parsed.evaluation.verdict).toBe("PASS")
    }

    const local = InferenceReceiptSchema.parse(receiptFor("RESIDENT_LOCAL"))
    expect(local.actualPlacement.runtime).toMatchObject({
      kind: "OLLAMA",
      version: "0.9.2",
      artifact: { kind: "NATIVE_BINARY", binaryDigest: digest("b") },
    })
  })

  it("rejects silent model alias or revision redirection", () => {
    const receipt = receiptFor("MANAGED_OPEN")
    const requestedModel = model({
      id: "model.requested-qwen3",
      repository: "provider://managed_open/qwen3",
      revision: "provider-version-2026-08-20",
      immutableIdentity: "provider://managed_open/qwen3@provider-version-2026-08-20",
      quantization: { disclosure: "PROVIDER_UNDISCLOSED" },
      artifactDigest: undefined,
    })
    const silentlyRedirected = { ...receipt, requestedModel }

    expect(InferenceReceiptSchema.safeParse(silentlyRedirected).success).toBe(false)

    const explicitlyRedirected = {
      ...silentlyRedirected,
      retryCount: 1,
      fallbackHistory: [
        {
          attempt: 1,
          failureClass: "MODEL_REVISION_WITHDRAWN",
          fromProvider: receipt.requestedProvider,
          fromModel: requestedModel,
          toProvider: receipt.actualProvider,
          toModel: receipt.actualModel,
          placementDecisionId: "placement.if-01.redirect.1",
          occurredAt: timestamp,
        },
      ],
      modelRedirection: {
        kind: "EXPLICIT_REVISION_REDIRECT",
        fromImmutableIdentity: requestedModel.immutableIdentity,
        fromRevision: requestedModel.revision,
        toImmutableIdentity: receipt.actualModel.immutableIdentity,
        toRevision: receipt.actualModel.revision,
        reason: "Pinned revision was withdrawn after placement and policy authorized the replacement.",
        authorityRef: "authority://if-01/model-redirect",
        evidenceRef: "evidence://if-01/model-redirect",
      },
    }

    expect(InferenceReceiptSchema.safeParse(explicitlyRedirected).success).toBe(true)
  })

  it("requires internally consistent, complete inference accounting", () => {
    const receipt = receiptFor("BROKERED")

    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        tokenUsage: { input: 900, output: 100, total: 999 },
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        latency: { ...receipt.latency, totalMs: 100 },
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        actualPlacement: { ...receipt.actualPlacement, provider: provider("DIRECT_FRONTIER") },
      }).success,
    ).toBe(false)
  })

  it("requires a contiguous exact fallback chain for every retry and substitution", () => {
    const receipt = receiptFor("DIRECT_FRONTIER")
    const requestedProvider = provider("RESIDENT_LOCAL")
    const broker = provider("BROKERED")
    const validFallbackReceipt = {
      ...receipt,
      requestedProvider,
      retryCount: 2,
      fallbackHistory: [
        {
          attempt: 1,
          failureClass: "RUNTIME_UNHEALTHY",
          fromProvider: requestedProvider,
          fromModel: receipt.requestedModel,
          toProvider: broker,
          toModel: receipt.requestedModel,
          placementDecisionId: "placement.fallback.1",
          occurredAt: timestamp,
        },
        {
          attempt: 2,
          failureClass: "PROVIDER_RATE_LIMITED",
          fromProvider: broker,
          fromModel: receipt.requestedModel,
          toProvider: receipt.actualProvider,
          toModel: receipt.actualModel,
          placementDecisionId: "placement.fallback.2",
          occurredAt: "2026-08-27T16:00:00.100Z",
        },
      ],
    }

    expect(InferenceReceiptSchema.safeParse(validFallbackReceipt).success).toBe(true)
    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        requestedProvider,
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...validFallbackReceipt,
        retryCount: 1,
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...validFallbackReceipt,
        fallbackHistory: [
          validFallbackReceipt.fallbackHistory[0],
          { ...validFallbackReceipt.fallbackHistory[1], attempt: 3 },
        ],
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...validFallbackReceipt,
        fallbackHistory: [
          validFallbackReceipt.fallbackHistory[0],
          {
            ...validFallbackReceipt.fallbackHistory[1],
            fromProvider: { ...broker, serviceIdentity: "Contradictory broker service" },
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...validFallbackReceipt,
        fallbackHistory: [
          validFallbackReceipt.fallbackHistory[0],
          { ...validFallbackReceipt.fallbackHistory[1], toProvider: broker },
        ],
      }).success,
    ).toBe(false)
  })

  it("cross-checks complete placement provider and model identities", () => {
    const receipt = receiptFor("MANAGED_OPEN")

    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        actualPlacement: {
          ...receipt.actualPlacement,
          provider: {
            ...receipt.actualProvider,
            class: "BROKERED",
            serviceIdentity: "Contradictory service behind reused provider id",
          },
        },
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        actualPlacement: {
          ...receipt.actualPlacement,
          model: {
            ...receipt.actualModel,
            repository: "provider://contradictory/model-repository",
          },
        },
      }).success,
    ).toBe(false)
    expect(
      InferenceReceiptSchema.safeParse({
        ...receipt,
        actualPlacement: {
          ...receipt.actualPlacement,
          model: {
            ...receipt.actualModel,
            license: {
              ...receipt.actualModel.license,
              evidenceRef: "evidence://contradictory/license",
            },
          },
        },
      }).success,
    ).toBe(false)
  })
})

describe("reservation and evaluation contracts", () => {
  it("records immutable placement candidates, hard-gate refusals, and the exact selection", () => {
    const selection = receiptFor("RESIDENT_LOCAL").actualPlacement
    const decision = {
      id: "placement.if-01.1",
      requestId: "request.if-01.1",
      requirementId: "request.if-01.1",
      contextPackageId: "context.thread-964.1",
      considered: [
        {
          candidateId: "candidate.local-ollama",
          eligible: true,
          refusals: [],
          score: 0.94,
          evidenceRefs: ["evidence://placement/local-ollama"],
        },
        {
          candidateId: "candidate.remote-denied",
          eligible: false,
          refusals: ["POLICY_DENIED_REMOTE"],
          evidenceRefs: ["policy://egress/s4-local-only"],
        },
      ],
      selected: selection,
      fallbackCandidateIds: [],
      policyDigest: digest("6"),
      reason: "Resident placement passed all hard gates.",
      decidedAt: timestamp,
    }

    expect(PlacementDecisionSchema.safeParse(decision).success).toBe(true)
    expect(
      PlacementDecisionSchema.safeParse({
        ...decision,
        considered: [{ ...decision.considered[1], refusals: [] }],
      }).success,
    ).toBe(false)
  })

  it("covers runtime features with scoped evidence", () => {
    const capability = {
      runtimeId: "runtime.hermes-ollama",
      runtimeVersion: "0.9.2",
      hardwarePlatform: "NVIDIA_PASCAL",
      feature: "structured-output",
      verdict: "PROVEN",
      evidenceRef: "evidence://runtime/ollama/structured-output",
      observedAt: timestamp,
    }

    expect(RuntimeCapabilitySchema.safeParse(capability).success).toBe(true)
    expect(
      RuntimeCapabilitySchema.safeParse({
        ...capability,
        evidenceRef: undefined,
      }).success,
    ).toBe(false)
  })

  it("accounts independently for weight, KV, runtime, system-memory, and CPU capacity", () => {
    const capacity = {
      computeResourceId: "compute.hermes-p40",
      totalAcceleratorMemoryBytes: 24_000,
      reservedWeightBytes: 8_000,
      reservedKvBytes: 6_000,
      reservedRuntimeOverheadBytes: 2_000,
      totalSystemMemoryBytes: 64_000,
      reservedSystemMemoryBytes: 16_000,
      totalCpuLogicalCores: 16,
      reservedCpuLogicalCores: 4,
      currentReservationIds: ["reservation.if-01.1"],
      modelResidencyAllocations: [
        { modelArtifactId: "model.qwen3-4b-64k", weightBytes: 8_000, kvBytes: 6_000 },
      ],
      observedAt: timestamp,
    }

    expect(ResourceCapacitySchema.safeParse(capacity).success).toBe(true)
    expect(
      ResourceCapacitySchema.safeParse({
        ...capacity,
        reservedKvBytes: 20_000,
      }).success,
    ).toBe(false)
    expect(
      ResourceCapacitySchema.safeParse({
        ...capacity,
        reservedCpuLogicalCores: 17,
      }).success,
    ).toBe(false)
  })

  it("validates exact reservation capacity, lease, and fencing data", () => {
    expect(
      AcceleratorReservationSchema.parse({
        id: "reservation.if-01.1",
        requestId: "request.if-01.1",
        computeResourceId: "compute.hermes-p40",
        workRef: "IF-01",
        threadId: "thread.964",
        modelArtifactId: "model.qwen3-4b-64k",
        requestedWeightBytes: 4_000_000_000,
        requestedKvBytes: 6_000_000_000,
        requestedRuntimeOverheadBytes: 1_000_000_000,
        requestedSystemMemoryBytes: 8_000_000_000,
        priority: "NORMAL",
        preemptible: false,
        fencingToken: 7,
        leaseExpiresAt: "2026-08-27T16:05:00.000Z",
        state: "ACTIVE",
      }),
    ).toMatchObject({ fencingToken: 7, state: "ACTIVE" })
  })

  it("prevents capability evidence from self-promoting", () => {
    const evaluation = {
      id: "evaluation.if-01.1",
      capabilityId: "capability.governed-code",
      capabilityVersion: "1",
      model: model(),
      runtime: localRuntime(),
      runtimeConfigurationDigest: digest("8"),
      computeClass: "NVIDIA_PASCAL_24GB",
      verdict: "PROVEN",
      evidenceRef: "evidence://evaluation/if-01/1",
      measuredAt: timestamp,
      metrics: { schemaValidity: 1, ownerTouchCount: 0 },
      measuredBy: "agent.measurement-worker",
      promotedBy: "agent.independent-reviewer",
    }

    expect(CapabilityEvaluationSchema.safeParse(evaluation).success).toBe(true)
    expect(
      CapabilityEvaluationSchema.safeParse({
        ...evaluation,
        promotedBy: evaluation.measuredBy,
      }).success,
    ).toBe(false)
  })
})

describe("context, egress, and execution contracts", () => {
  it("requires a compiled context package with sections, exclusions, compression, provenance, and time", () => {
    const contextPackage = {
      id: "context.thread-964.1",
      schemaVersion: 1,
      projectId: "project.intelligence-fabric",
      threadId: "thread.964",
      workOrderRef: "IF-01",
      sourceRefs: ["atlas://threads/964"],
      authorityRef: "authority://issue/964#if-01",
      classification: "S2",
      includedSections: [
        {
          kind: "thread-state",
          sourceRef: "atlas://threads/964",
          digest: digest("2"),
        },
      ],
      excludedClasses: ["credentials", "unrelated-private-world"],
      compressionSteps: [
        {
          kind: "deterministic-summary",
          inputDigest: digest("2"),
          outputDigest: digest("3"),
          evidenceRef: "evidence://context/compression/1",
        },
      ],
      provenance: [
        {
          sourceRef: "atlas://threads/964",
          sourceDigest: digest("2"),
          selectedBy: "context-compiler.v1",
        },
      ],
      estimatedTokens: 2_400,
      digest: digest("4"),
      compiledAt: timestamp,
    }

    expect(ContextPackageSchema.safeParse(contextPackage).success).toBe(true)
    expect(
      ContextPackageSchema.safeParse({ ...contextPackage, provenance: [] }).success,
    ).toBe(false)
    expect(
      ContextPackageSchema.safeParse({ ...contextPackage, compiledAt: undefined }).success,
    ).toBe(false)
  })

  it("governs every egress category independently", () => {
    const policy = {
      id: "egress.s2-local",
      schemaVersion: 1,
      dataClass: "S2",
      prompts: "LOCAL_ONLY",
      retrievedDocuments: "LOCAL_ONLY",
      generatedEmbeddings: "DENIED",
      kvCacheState: "DENIED",
      logsAndTraces: "LOCAL_ONLY",
      modelArtifacts: "APPROVED_PRIVATE_REMOTE",
      telemetry: "LOCAL_ONLY",
      toolAndNetworkAccess: "DENIED",
      authorityRef: "authority://egress/s2-local",
      policyDigest: digest("5"),
    }

    expect(EgressPolicySchema.safeParse(policy).success).toBe(true)
    const { telemetry: _telemetry, ...missingTelemetry } = policy
    expect(EgressPolicySchema.safeParse(missingTelemetry).success).toBe(false)
    expect(
      EgressPolicySchema.safeParse({ ...policy, allowAll: true }).success,
    ).toBe(false)
  })

  it("records typed inference execution state without collapsing failures", () => {
    const execution = {
      id: "execution.if-01.1",
      requestId: "request.if-01.1",
      requirementId: "request.if-01.1",
      placementDecisionId: "placement.if-01.1",
      contextPackageId: "context.thread-964.1",
      reservationId: "reservation.if-01.1",
      state: "FAILED",
      failureClass: "MODEL_OOM",
      startedAt: timestamp,
      finishedAt: "2026-08-27T16:00:01.000Z",
      metrics: { peakVramBytes: 25_000_000_000, retryable: true },
      toolEvidenceRefs: [],
    }

    expect(InferenceExecutionSchema.safeParse(execution).success).toBe(true)
    expect(
      InferenceExecutionSchema.safeParse({
        ...execution,
        failureClass: undefined,
      }).success,
    ).toBe(false)
    expect(
      InferenceExecutionSchema.safeParse({
        ...execution,
        state: "COMPLETED",
      }).success,
    ).toBe(false)
  })
})

describe("deterministic lifecycle transition validation", () => {
  it("accepts exactly the declared reservation transitions", () => {
    for (const from of RESERVATION_STATES) {
      for (const to of RESERVATION_STATES) {
        expect(isValidReservationTransition(from, to), `${from} -> ${to}`).toBe(
          RESERVATION_TRANSITIONS[from].includes(to),
        )
      }
    }

    expect(isValidReservationTransition("REQUESTED", "ACTIVE")).toBe(true)
    expect(isValidReservationTransition("ACTIVE", "RELEASED")).toBe(true)
    expect(isValidReservationTransition("RELEASED", "ACTIVE")).toBe(false)
    expect(isValidReservationTransition("ACTIVE", "ACTIVE")).toBe(false)
  })

  it("accepts exactly the declared elastic-worker transitions", () => {
    for (const from of ELASTIC_WORKER_STATES) {
      for (const to of ELASTIC_WORKER_STATES) {
        expect(isValidElasticWorkerTransition(from, to), `${from} -> ${to}`).toBe(
          ELASTIC_WORKER_TRANSITIONS[from].includes(to),
        )
      }
    }

    const happyPath: ElasticWorkerState[] = [
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
    ]
    for (let index = 0; index < happyPath.length - 1; index += 1) {
      expect(isValidElasticWorkerTransition(happyPath[index], happyPath[index + 1])).toBe(true)
    }

    expect(isValidElasticWorkerTransition("DESTROYED", "READY")).toBe(false)
    expect(isValidElasticWorkerTransition("EXECUTING", "DESTROYED")).toBe(false)
    expect(isValidElasticWorkerTransition("FAILED", "DESTROYING")).toBe(true)
  })

  it("requires elastic providers and destruction evidence", () => {
    const worker = {
      id: "elastic-worker.if-01.1",
      provider: provider("ELASTIC_OPEN"),
      computeResourceId: "compute.elastic-h100",
      workRef: "IF-01",
      state: "DESTROYED",
      shortLivedIdentityRef: "identity://elastic/if-01/1",
      provisionEvidenceRef: "evidence://elastic/provision/1",
      wipeEvidenceRef: "evidence://elastic/wipe/1",
      destructionEvidenceRef: "evidence://elastic/destroy/1",
      maxCostUsd: 2.5,
      expiresAt: "2026-08-27T17:00:00.000Z",
    }

    expect(ElasticWorkerSchema.safeParse(worker).success).toBe(true)
    expect(
      ElasticWorkerSchema.safeParse({ ...worker, provider: provider("BROKERED") }).success,
    ).toBe(false)
    expect(
      ElasticWorkerSchema.safeParse({ ...worker, destructionEvidenceRef: undefined }).success,
    ).toBe(false)
  })

  it("does not accept undeclared lifecycle states at the type boundary", () => {
    expect(
      AcceleratorReservationSchema.safeParse({
        id: "reservation.invalid",
        requestId: "request.invalid",
        computeResourceId: "compute.invalid",
        workRef: "IF-01",
        requestedWeightBytes: 0,
        requestedKvBytes: 0,
        requestedRuntimeOverheadBytes: 0,
        requestedSystemMemoryBytes: 0,
        priority: "NORMAL",
        preemptible: true,
        fencingToken: 1,
        leaseExpiresAt: timestamp,
        state: "RUNNING",
      }).success,
    ).toBe(false)
  })
})

// Compile-time evidence that the public transition helpers accept only their own state domains.
const _reservationState: ReservationState = "REQUESTED"
const _elasticState: ElasticWorkerState = "REQUESTED"
void [_reservationState, _elasticState]
