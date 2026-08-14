export type WorkbenchViewMode = "home" | "projects" | "activity" | "system"

export type WorkbenchInspectorTab =
  | "overview"
  | "changes"
  | "proof"
  | "decision"
  | "technical"

export type WorkbenchFocus =
  | "explorer"
  | "thread"
  | "inspector"
  | "execution"
  | "intent"

export type WorkbenchMobilePane =
  | "explorer"
  | "thread"
  | "inspector"
  | "execution"

export interface WorkbenchState {
  viewMode: WorkbenchViewMode
  selectedProjectId: string | null
  selectedThreadId: string | null
  inspectorTab: WorkbenchInspectorTab
  executionExpanded: boolean
  foregroundFocus: WorkbenchFocus
  mobilePane: WorkbenchMobilePane
  backgroundVersion: number
  backgroundObservedAt: string | null
}

export interface WorkbenchRestoration {
  schemaVersion: 1
  viewMode: WorkbenchViewMode
  selectedProjectId: string | null
  selectedThreadId: string | null
  inspectorTab: WorkbenchInspectorTab
  executionExpanded: boolean
  foregroundFocus: WorkbenchFocus
  mobilePane: WorkbenchMobilePane
}

const viewModes: readonly WorkbenchViewMode[] = [
  "home",
  "projects",
  "activity",
  "system",
]
const inspectorTabs: readonly WorkbenchInspectorTab[] = [
  "overview",
  "changes",
  "proof",
  "decision",
  "technical",
]
const focusTargets: readonly WorkbenchFocus[] = [
  "explorer",
  "thread",
  "inspector",
  "execution",
  "intent",
]
const mobilePanes: readonly WorkbenchMobilePane[] = [
  "explorer",
  "thread",
  "inspector",
  "execution",
]
const restorationKeys = [
  "schemaVersion",
  "viewMode",
  "selectedProjectId",
  "selectedThreadId",
  "inspectorTab",
  "executionExpanded",
  "foregroundFocus",
  "mobilePane",
] as const

export type WorkbenchAction =
  | {
      type: "USER_SELECT_PROJECT"
      projectId: string | null
      availableProjectIds: readonly string[]
    }
  | {
      type: "USER_SELECT_THREAD"
      threadId: string | null
      availableThreadIds: readonly string[]
    }
  | { type: "USER_SET_INSPECTOR_TAB"; inspectorTab: WorkbenchInspectorTab }
  | { type: "USER_SET_VIEW_MODE"; viewMode: WorkbenchViewMode }
  | { type: "USER_SET_EXECUTION_EXPANDED"; expanded: boolean }
  | { type: "USER_SET_FOCUS"; focus: WorkbenchFocus }
  | { type: "USER_SET_MOBILE_PANE"; pane: WorkbenchMobilePane }
  | {
      type: "USER_RESTORE_STATE"
      serialized: string
      availableProjectIds: readonly string[]
      availableThreadIdsByProject: Readonly<Record<string, readonly string[]>>
    }
  | {
      type: "BACKGROUND_REFRESH"
      version: number
      observedAt: string
    }

export function createInitialWorkbenchState(): WorkbenchState {
  return {
    viewMode: "home",
    selectedProjectId: null,
    selectedThreadId: null,
    inspectorTab: "overview",
    executionExpanded: false,
    foregroundFocus: "thread",
    mobilePane: "thread",
    backgroundVersion: 0,
    backgroundObservedAt: null,
  }
}

export function serializeWorkbenchRestoration(state: WorkbenchState): string {
  const restoration: WorkbenchRestoration = {
    schemaVersion: 1,
    viewMode: state.viewMode,
    selectedProjectId: state.selectedProjectId,
    selectedThreadId: state.selectedThreadId,
    inspectorTab: state.inspectorTab,
    executionExpanded: state.executionExpanded,
    foregroundFocus: state.foregroundFocus,
    mobilePane: state.mobilePane,
  }

  return JSON.stringify(restoration)
}

function isSelectionIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  )
}

function isNullableIdentifier(value: unknown): value is string | null {
  return value === null || isSelectionIdentifier(value)
}

export function parseWorkbenchRestoration(serialized: string): WorkbenchRestoration | null {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    return null
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== restorationKeys.length ||
    keys.some((key) => !restorationKeys.includes(key as (typeof restorationKeys)[number]))
  ) {
    return null
  }
  if (
    record.schemaVersion !== 1 ||
    !viewModes.includes(record.viewMode as WorkbenchViewMode) ||
    !isNullableIdentifier(record.selectedProjectId) ||
    !isNullableIdentifier(record.selectedThreadId) ||
    (record.selectedProjectId === null && record.selectedThreadId !== null) ||
    !inspectorTabs.includes(record.inspectorTab as WorkbenchInspectorTab) ||
    typeof record.executionExpanded !== "boolean" ||
    !focusTargets.includes(record.foregroundFocus as WorkbenchFocus) ||
    !mobilePanes.includes(record.mobilePane as WorkbenchMobilePane)
  ) {
    return null
  }

  return record as unknown as WorkbenchRestoration
}

export function reduceWorkbenchState(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case "USER_SELECT_PROJECT":
      if (action.projectId === null) {
        return { ...state, selectedProjectId: null, selectedThreadId: null }
      }
      if (
        !isSelectionIdentifier(action.projectId) ||
        !action.availableProjectIds.includes(action.projectId)
      ) {
        return state
      }
      return {
        ...state,
        selectedProjectId: action.projectId,
        selectedThreadId: null,
      }
    case "USER_SELECT_THREAD":
      if (action.threadId === null) return { ...state, selectedThreadId: null }
      if (
        state.selectedProjectId === null ||
        !isSelectionIdentifier(action.threadId) ||
        !action.availableThreadIds.includes(action.threadId)
      ) {
        return state
      }
      return { ...state, selectedThreadId: action.threadId }
    case "USER_SET_INSPECTOR_TAB":
      return { ...state, inspectorTab: action.inspectorTab }
    case "USER_SET_VIEW_MODE":
      return { ...state, viewMode: action.viewMode }
    case "USER_SET_EXECUTION_EXPANDED":
      return { ...state, executionExpanded: action.expanded }
    case "USER_SET_FOCUS":
      return { ...state, foregroundFocus: action.focus }
    case "USER_SET_MOBILE_PANE":
      return { ...state, mobilePane: action.pane }
    case "USER_RESTORE_STATE": {
      const restoration = parseWorkbenchRestoration(action.serialized)
      if (restoration === null) return state
      if (
        restoration.selectedProjectId !== null &&
        !action.availableProjectIds.includes(restoration.selectedProjectId)
      ) {
        return state
      }
      if (
        restoration.selectedThreadId !== null &&
        !action.availableThreadIdsByProject[
          restoration.selectedProjectId as string
        ]?.includes(restoration.selectedThreadId)
      ) {
        return state
      }
      return {
        ...state,
        viewMode: restoration.viewMode,
        selectedProjectId: restoration.selectedProjectId,
        selectedThreadId: restoration.selectedThreadId,
        inspectorTab: restoration.inspectorTab,
        executionExpanded: restoration.executionExpanded,
        foregroundFocus: restoration.foregroundFocus,
        mobilePane: restoration.mobilePane,
      }
    }
    case "BACKGROUND_REFRESH":
      if (
        !Number.isSafeInteger(action.version) ||
        action.version <= state.backgroundVersion
      ) {
        return state
      }
      return {
        ...state,
        backgroundVersion: action.version,
        backgroundObservedAt: action.observedAt,
      }
    default:
      return state
  }
}
