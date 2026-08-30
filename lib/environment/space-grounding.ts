import type { WorkingWorldSnapshot } from "@/lib/environment/working-world"

export type SpaceGrounding = Readonly<{
  facts: string
  version: string
}>

/**
 * Build one deterministic, server-owned representation of the facts used by selected-Space
 * Summarize. The same representation is used as the inference facts and the CAS version source so
 * no displayed fact can change while inference is running without invalidating the reply.
 */
export function deriveSpaceGrounding(world: WorkingWorldSnapshot): SpaceGrounding {
  const space = world.space
  const activePane = space?.panes.find((pane) => pane.id === space.activePaneId) ?? null
  const truth = {
    intent: world.intent,
    project: {
      id: world.spine.projectId,
      name: world.spine.projectName,
      threadId: world.spine.threadId,
    },
    space: space ? {
      revision: space.revision,
      surfaces: space.windows.map((window) => {
        const active = !window.minimized && window.id === space.activeWindowId
        return {
          id: window.id,
          kind: window.kind,
          title: window.title,
          state: window.minimized ? "minimized" : active ? "active" : "open",
          active,
          minimized: window.minimized,
        }
      }),
      selectedPath: space.selection?.filePath ?? activePane?.filePath ?? null,
      selection: space.selection
        ? { anchor: space.selection.anchor, head: space.selection.head }
        : activePane?.selection
          ? { anchor: activePane.selection.anchor, head: activePane.selection.head }
          : null,
      openFiles: [...space.openFiles],
    } : null,
    spine: {
      outcome: {
        key: world.spine.outcomeKey,
        title: world.spine.outcomeTitle,
        workOrderId: world.spine.workOrderId,
      },
      execution: world.spine.execution,
      worker: world.spine.worker,
      evidence: [...world.spine.evidence],
    },
    judgment: world.judgment,
    agentWork: [...world.agentWork],
  }
  const version = JSON.stringify(truth)
  return {
    version,
    facts: [
      "Exact persisted Space truth (server-derived):",
      JSON.stringify(truth, null, 2),
      "Browser-only live agent and tool transcripts are unavailable in this server-owned summary and were not inferred.",
    ].join("\n"),
  }
}
