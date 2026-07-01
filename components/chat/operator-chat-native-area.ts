export type OperatorChatPostureSummaryItem = {
  label: string
  value: string
  description: string
}

export type OperatorChatCommandSection = {
  label: string
  posture: string
  purpose: string
  boundary: string
  evidenceLinkage: string
  nextSafeStep: string
}

export type OperatorChatAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type OperatorChatNativeArea = {
  title: string
  eyebrow: string
  description: string
  postureSummary: OperatorChatPostureSummaryItem[]
  sections: OperatorChatCommandSection[]
  authorityBoundaries: OperatorChatAuthorityBoundary[]
  suggestions: string[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    nativeToWilliamOS: true
    changesChatRuntime: false
    changesModelProvider: false
    changesMessagePersistence: false
    changesMemoryWrites: false
    changesRetrieval: false
    activatesToolExecution: false
    activatesAutonomousAction: false
    executesWorkOrders: false
    changesAuthBehavior: false
    activatesAccessGrants: false
    mutatesSchema: false
    changesEnv: false
    changesPackage: false
    changesVercelSettings: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getOperatorChatNativeArea(): OperatorChatNativeArea {
  return {
    title: "Operator Chat",
    eyebrow: "WilliamOS Command Conversation",
    description:
      "Operator Chat is the native WilliamOS command conversation surface for the Primary: ask, inspect, prepare, route, review, draft next moves, and shape safe handoffs without autonomous execution.",
    postureSummary: [
      {
        label: "Conversation",
        value: "Primary-centered",
        description:
          "The surface is for command conversation with WilliamOS, not social chat or generic assistance.",
      },
      {
        label: "Context",
        value: "grounded",
        description:
          "Responses can use existing WilliamOS context such as Memory, Corpus, Doctrine, Decisions, and Evidence where current retrieval supports it.",
      },
      {
        label: "Authority",
        value: "required",
        description:
          "The conversation may prepare and propose; execution, approval, and production action remain gated.",
      },
    ],
    sections: [
      {
        label: "Ask",
        posture: "Inspect",
        purpose: "Ask focused questions about WilliamOS context, current posture, or next moves.",
        boundary: "This is not an open-ended assistant identity or a social conversation surface.",
        evidenceLinkage: "Prefer answers that cite source context or point to Evidence.",
        nextSafeStep: "Ask a specific context question before turning the answer into action.",
      },
      {
        label: "Inspect",
        posture: "Context review",
        purpose: "Review existing Memory, Corpus, Doctrine, Decisions, and related context.",
        boundary: "This reframe does not change retrieval, indexing, or source selection behavior.",
        evidenceLinkage: "Claims should remain traceable to available source context.",
        nextSafeStep: "Move important findings into Evidence or Work Orders before relying on them.",
      },
      {
        label: "Prepare",
        posture: "Draft only",
        purpose: "Shape a safe next move, Work Order outline, or decision packet.",
        boundary: "Preparation does not execute the work or grant authority.",
        evidenceLinkage: "Prepared work should include validation and evidence expectations.",
        nextSafeStep: "Review scope and blocked actions before any implementation begins.",
      },
      {
        label: "Route",
        posture: "Governed",
        purpose: "Route outputs toward Decisions, Work Orders, Evidence, or Memory review.",
        boundary: "Routing is guidance only; no automatic mutation or navigation action is triggered.",
        evidenceLinkage: "Use the right surface so the recommendation can be audited later.",
        nextSafeStep: "Select the governed surface that matches the decision or evidence need.",
      },
      {
        label: "Review",
        posture: "Evidence required",
        purpose: "Compare recommendations against available evidence and authority boundaries.",
        boundary: "Unsupported claims do not become trusted system state.",
        evidenceLinkage: "Evidence remains the proof layer for completion and safety claims.",
        nextSafeStep: "Hold action until missing proof is gathered or explicitly marked unknown.",
      },
      {
        label: "Draft Next Move",
        posture: "Authority gated",
        purpose: "Draft the next safe move for the Primary to inspect.",
        boundary: "The Primary decides; WilliamOS does not self-authorize the move.",
        evidenceLinkage: "Next moves should name required validation and stop conditions.",
        nextSafeStep: "Convert approved next moves into scoped Work Orders.",
      },
      {
        label: "Safe Handoff",
        posture: "No dispatch",
        purpose: "Shape handoff packets for future review or authorized workers.",
        boundary: "No worker, Hermes path, MCP tool, or autonomous execution is launched.",
        evidenceLinkage: "Handoffs should preserve scope, proof, risks, and blocked actions.",
        nextSafeStep: "Keep handoffs preview-only until a separate authority gate exists.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Runtime",
        state: "Unchanged",
        description:
          "This native-area reframe does not change the chat runtime, model provider, or API route.",
      },
      {
        label: "Retrieval",
        state: "Unchanged",
        description:
          "Memory, Corpus, Doctrine, citation, and context retrieval behavior are not changed.",
      },
      {
        label: "Execution",
        state: "Blocked",
        description:
          "No tool execution, Work Order execution, Hermes activation, MCP activation, or autonomous action is enabled.",
      },
    ],
    suggestions: [
      "What needs Primary attention before the next move?",
      "Inspect the evidence behind the current recommendation.",
      "Draft a safe Work Order outline without executing it.",
    ],
    links: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Turn prepared next moves into governed scope.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Check the proof layer before trusting a claim.",
      },
      {
        label: "Decisions",
        href: "/decisions",
        description: "Route owner choices and blocked questions into review.",
      },
      {
        label: "Memory",
        href: "/memory",
        description: "Inspect continuity before treating context as durable.",
      },
    ],
    safety: {
      nativeToWilliamOS: true,
      changesChatRuntime: false,
      changesModelProvider: false,
      changesMessagePersistence: false,
      changesMemoryWrites: false,
      changesRetrieval: false,
      activatesToolExecution: false,
      activatesAutonomousAction: false,
      executesWorkOrders: false,
      changesAuthBehavior: false,
      activatesAccessGrants: false,
      mutatesSchema: false,
      changesEnv: false,
      changesPackage: false,
      changesVercelSettings: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
