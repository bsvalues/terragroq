import { getBrainCouncilReadinessEvaluation } from "@/components/brain-council/brain-council-readiness"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"

export type BrainCouncilWorkerPacketPreview = {
  packetId: string
  targetWorker: "Codex or Claude"
  mode: "read-only preview"
  objective: string
  evidence: string[]
  requiredChecks: string[]
  allowedActions: string[]
  deniedActions: string[]
  expectedOutput: string[]
  dispatch: {
    enabled: false
    reason: string
  }
  safety: {
    readOnly: true
    wouldExecute: false
    queueMutation: false
    externalWorkerExecution: false
    autonomyEnabled: false
    productionWrite: false
  }
}

export function getBrainCouncilWorkerPacketPreview(): BrainCouncilWorkerPacketPreview {
  const reasoning = getBrainCouncilReasoningPacket()
  const readiness = getBrainCouncilReadinessEvaluation()

  return {
    packetId: "BC-WORKER-PREVIEW-001",
    targetWorker: "Codex or Claude",
    mode: "read-only preview",
    objective: reasoning.decisionPacket.nextAction,
    evidence: reasoning.evidence.map((item) => `${item.label}: ${item.summary}`),
    requiredChecks: readiness.checks.map((check) => `${check.label}: ${check.status}`),
    allowedActions: [
      "inspect scoped files",
      "run focused validation",
      "run full validation",
      "report safety posture",
      "stop on hard-stop conditions",
    ],
    deniedActions: [
      "execute Brain Council",
      "activate MCP",
      "enable autonomy",
      "mutate queues",
      "dispatch workers",
      "write production data",
      "change env or Vercel settings",
    ],
    expectedOutput: [
      "RESULT",
      "WORK_ORDER",
      "FILES_CHANGED",
      "VALIDATION",
      "SAFETY_POSTURE",
      "NEXT_TRANSITION",
    ],
    dispatch: {
      enabled: false,
      reason: "Worker packets are preview-only until a separate runtime authorization exists.",
    },
    safety: {
      readOnly: true,
      wouldExecute: false,
      queueMutation: false,
      externalWorkerExecution: false,
      autonomyEnabled: false,
      productionWrite: false,
    },
  }
}
