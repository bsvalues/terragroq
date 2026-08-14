"use client"

import { createContext, useContext } from "react"

export type WorkbenchContextValue = Readonly<{
  focusThread: (target: { projectId: number; threadId: string }) => void
}>

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export const WorkbenchContextProvider = WorkbenchContext.Provider

export function useWorkbenchContext(): WorkbenchContextValue | null {
  return useContext(WorkbenchContext)
}
