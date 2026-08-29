import { randomUUID } from "node:crypto"

import { z } from "zod"

import { CHAT_MODEL, INFERENCE_BASE_URL } from "@/lib/ai/config"
import { isLoopbackInferenceBase, resolveOllamaChatModel } from "@/lib/ai/ollama-models"
import { validateCouncilSession, type CouncilSession } from "@/lib/environment/council-session"
import type { WorkingWorldSnapshot } from "@/lib/environment/working-world"

export type { CouncilSession } from "@/lib/environment/council-session"

const selectedContextSchema = z.object({
  kind: z.enum(["space", "file", "preview", "diff", "agent", "selection"]),
  label: z.string().trim().min(1).max(500),
}).strict()

export const councilRequestSchema = z.object({
  worldId: z.string().uuid(),
  question: z.string().trim().min(1).max(4_000),
  selectedContext: selectedContextSchema,
}).strict()

export type CouncilRequest = z.infer<typeof councilRequestSchema>

const roleResponseSchema = z.object({
  perspective: z.string().trim().min(1).max(4_000),
}).strict()

const synthesisResponseSchema = z.object({
  consensus: z.string().trim().min(1).max(4_000),
  dissent: z.string().trim().min(1).max(4_000),
  blindSpot: z.string().trim().min(1).max(4_000),
  recommendation: z.string().trim().min(1).max(4_000),
  confidence: z.number().finite().min(0).max(100),
}).strict()

const COUNCIL_ROLES = [
  {
    id: "architect",
    role: "Architect",
    name: "Atlas",
    charge: "Evaluate structure, boundaries, cohesion, and long-term product consequences.",
  },
  {
    id: "verifier",
    role: "Verifier",
    name: "Veritas",
    charge: "Challenge unsupported claims and identify the proof needed for acceptance.",
  },
  {
    id: "operator",
    role: "Operator",
    name: "Nyx",
    charge: "Evaluate the concrete owner workflow, friction, recovery, and next usable action.",
  },
  {
    id: "researcher",
    role: "Researcher",
    name: "Orion",
    charge: "Separate supplied evidence from assumptions and identify material missing information.",
  },
  {
    id: "risk",
    role: "Recovery / Risk",
    name: "Phoenix",
    charge: "Argue the strongest credible dissent and identify failure or recovery risks.",
  },
] as const

export class CouncilInferenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CouncilInferenceError"
  }
}

export class CouncilContextError extends Error {
  constructor() {
    super("COUNCIL_CONTEXT_MISMATCH")
    this.name = "CouncilContextError"
  }
}

type GroundedCouncilContext = Readonly<{
  spaceName: string
  kind: CouncilRequest["selectedContext"]["kind"]
  label: string
  outcomeTitle: string | null
  execution: string
  worker: string | null
  evidence: CouncilSession["evidence"]
}>

function inferenceProvider(): string {
  try {
    return new URL(INFERENCE_BASE_URL).host
  } catch {
    return "configured-openai-compatible"
  }
}

function extractJson(content: string): unknown {
  const trimmed = content.trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("No JSON object returned")
  return JSON.parse(trimmed.slice(start, end + 1))
}

async function inferJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  invalidMessage: string,
  model: string,
): Promise<T> {
  let response: Response
  try {
    const apiKey = process.env.WILLIAMOS_AI_API_KEY?.trim()
    response = await fetch(`${INFERENCE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are one bounded advisory participant in WilliamOS Brain Council. " +
              "Use only the supplied context and evidence. Never claim to execute work or possess owner authority. " +
              "Return only the requested JSON object, with no markdown.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 900,
        stream: false,
      }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch {
    throw new CouncilInferenceError(invalidMessage)
  }

  if (!response.ok) throw new CouncilInferenceError(invalidMessage)

  try {
    const body = await response.json() as { choices?: readonly { message?: { content?: unknown } }[] }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== "string") throw new Error("Missing content")
    const parsed = schema.safeParse(extractJson(content))
    if (!parsed.success) throw new Error("Invalid shape")
    return parsed.data
  } catch {
    throw new CouncilInferenceError(invalidMessage)
  }
}

function activePaneFile(world: WorkingWorldSnapshot): string | null {
  const activePane = world.space?.panes.find((pane) => pane.id === world.space?.activePaneId)
  return world.space?.selection?.filePath ?? activePane?.filePath ?? null
}

function activeWindow(world: WorkingWorldSnapshot) {
  return world.space?.windows.find((window) => window.id === world.space?.activeWindowId) ?? null
}

function groundedSpaceName(world: WorkingWorldSnapshot): string {
  // Persisted Council context is canonical product data. The Line intent may be substantially
  // longer than the display identity, so bind and bound it before any inference call.
  return (world.spine.projectName?.trim() || world.intent.trim()).slice(0, 500)
}

function groundCouncilContext(input: CouncilRequest, world: WorkingWorldSnapshot): GroundedCouncilContext {
  const spaceName = groundedSpaceName(world)
  const requested = input.selectedContext
  let label: string | null = null

  if (requested.kind === "space") {
    label = spaceName
  } else if (requested.kind === "file" || requested.kind === "selection") {
    label = activePaneFile(world)
    if (requested.kind === "file" && label !== requested.label) throw new CouncilContextError()
  } else if (requested.kind === "preview" || requested.kind === "diff") {
    const window = activeWindow(world)
    const expectedKind = requested.kind === "preview" ? "running-app" : "diff"
    if (!window || window.kind !== expectedKind) throw new CouncilContextError()
    label = window.title
  } else if (requested.kind === "agent") {
    label = world.spine.worker?.lane ?? null
  }

  if (!label) throw new CouncilContextError()

  const evidence: CouncilSession["evidence"] = [
    {
      id: "selected-context",
      label: `Selected ${requested.kind}`,
      detail: `${label} in ${spaceName}`,
    },
    ...world.spine.evidence.slice(-11).map((record, index) => ({
      id: `world-evidence-${index + 1}`,
      label: `${record.kind} · ${record.result ?? "recorded"}`,
      detail: record.detail,
    })),
  ]

  return {
    spaceName,
    kind: requested.kind,
    label,
    outcomeTitle: world.spine.outcomeTitle,
    execution: world.spine.execution,
    worker: world.spine.worker?.lane ?? null,
    evidence,
  }
}

function contextPrompt(input: CouncilRequest, grounded: GroundedCouncilContext): string {
  const evidence = grounded.evidence.map((item) => `[${item.id}] ${item.label}: ${item.detail}`).join("\n")
  return [
    `Owner question: ${input.question}`,
    `Selected Space: ${grounded.spaceName}`,
    `Selected ${grounded.kind}: ${grounded.label}`,
    grounded.outcomeTitle ? `Current outcome: ${grounded.outcomeTitle}` : "Current outcome: none bound",
    `Execution: ${grounded.execution}`,
    grounded.worker ? `Active worker: ${grounded.worker}` : "Active worker: none",
    `Evidence:\n${evidence}`,
  ].filter(Boolean).join("\n")
}

export async function conveneCouncil(input: CouncilRequest, world: WorkingWorldSnapshot): Promise<CouncilSession> {
  const grounded = groundCouncilContext(input, world)
  const context = contextPrompt(input, grounded)
  const provider = inferenceProvider()
  let model = CHAT_MODEL
  if (isLoopbackInferenceBase(INFERENCE_BASE_URL)) {
    const installed = await resolveOllamaChatModel(INFERENCE_BASE_URL, CHAT_MODEL)
    if (!installed.available || !installed.model) {
      throw new CouncilInferenceError(installed.detail === "LOCAL_CHAT_MODEL_UNAVAILABLE"
        ? "No local chat model is installed for Council."
        : "Local Council inference is unavailable.")
    }
    model = installed.model
  }

  const perspectives = await Promise.all(COUNCIL_ROLES.map(async (member) => {
    const result = await inferJson(
      `${context}\n\nYour role: ${member.role}. ${member.charge}\nReturn exactly: {"perspective":"your evidence-grounded advisory view"}`,
      roleResponseSchema,
      `${member.role} returned an invalid perspective.`,
      model,
    )
    return {
      id: member.id,
      role: member.role,
      name: member.name,
      provider,
      model,
      status: member.id === "risk" ? "dissenting" as const : "ready" as const,
      perspective: result.perspective,
    }
  }))

  const synthesis = await inferJson(
    [
      context,
      "Council perspectives:",
      ...perspectives.map((member) => `${member.role}: ${member.perspective}`),
      "Synthesize the actual agreement and strongest disagreement without erasing dissent.",
      "Return exactly: {\"consensus\":\"...\",\"dissent\":\"...\",\"blindSpot\":\"...\",\"recommendation\":\"...\",\"confidence\":0}",
      "Confidence must be a number from 0 to 100. The recommendation is advisory and must not imply execution authority.",
    ].join("\n\n"),
    synthesisResponseSchema,
    "Council synthesis returned invalid structured advice.",
    model,
  )

  return validateCouncilSession({
    id: `council-${randomUUID()}`,
    question: input.question,
    status: "ready",
    createdAt: new Date().toISOString(),
    context: {
      spaceName: grounded.spaceName,
      kind: grounded.kind,
      label: grounded.label,
    },
    members: perspectives,
    ...synthesis,
    confidence: Math.round(synthesis.confidence),
    evidence: grounded.evidence,
  })
}
