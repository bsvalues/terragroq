export type HermesWorkerPacketField = {
  label: string
  required: boolean
  description: string
}

export type HermesWorkerPacketSchema = {
  title: string
  summary: string
  requiredFields: HermesWorkerPacketField[]
  safetyChecks: string[]
  executionStatus: "not-active"
  safety: {
    schemaOnly: true
    executesPacket: false
    persistsPacket: false
    dispatchesWorker: false
    startsQueue: false
    writesProduction: false
  }
}

export function getHermesWorkerPacketSchema(): HermesWorkerPacketSchema {
  return {
    title: "Hermes worker packet schema",
    summary:
      "A worker packet describes what Hermes would need before any future authorized work. It is a requirements artifact only; packets cannot execute, persist, dispatch, or start queues from this surface.",
    executionStatus: "not-active",
    requiredFields: [
      {
        label: "Work Order",
        required: true,
        description: "The governed work unit that defines the mutation boundary.",
      },
      {
        label: "Goal",
        required: true,
        description: "The business outcome the work packet supports.",
      },
      {
        label: "Loop",
        required: true,
        description: "The read/verify/repair cycle the packet belongs to.",
      },
      {
        label: "Authority gate",
        required: true,
        description: "The explicit approval state required before any future activation.",
      },
      {
        label: "Allowed actions",
        required: true,
        description: "The only actions a future worker could perform if separately authorized.",
      },
      {
        label: "Blocked actions",
        required: true,
        description: "Actions that remain prohibited even when a packet exists.",
      },
      {
        label: "Target system",
        required: true,
        description: "The bounded system or surface the packet references.",
      },
      {
        label: "Evidence required",
        required: true,
        description: "Proof, validation, and production checks required before trust.",
      },
      {
        label: "Safety checks",
        required: true,
        description: "Controls that must pass before activation can be discussed.",
      },
      {
        label: "Rollback / stop condition",
        required: true,
        description: "Conditions that stop the worker or revert future changes.",
      },
      {
        label: "Operator approval state",
        required: true,
        description: "The Primary authority status for the packet.",
      },
      {
        label: "Execution status",
        required: true,
        description: "Must remain not-active in this phase.",
      },
    ],
    safetyChecks: [
      "Work Order exists",
      "Primary authority is explicit",
      "blocked actions are listed",
      "evidence requirements are listed",
      "rollback or stop condition is listed",
      "execution status remains not-active",
    ],
    safety: {
      schemaOnly: true,
      executesPacket: false,
      persistsPacket: false,
      dispatchesWorker: false,
      startsQueue: false,
      writesProduction: false,
    },
  }
}

export function isHermesWorkerPacketReviewable(
  fields: Partial<Record<HermesWorkerPacketField["label"], string>>,
): boolean {
  return getHermesWorkerPacketSchema().requiredFields.every((field) => {
    const value = fields[field.label]
    return !field.required || Boolean(value?.trim())
  })
}
