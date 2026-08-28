"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type ChangeState = Readonly<{
  running: boolean
  progress: string | null
  outcome: string | null
}>

type ChangeEvent = Readonly<{ type?: unknown; file?: unknown; text?: unknown; receipt?: unknown }>

const idle: ChangeState = { running: false, progress: null, outcome: null }

export function useSelectedFileChange({
  path,
  dirty,
  onVerifiedSuccess,
}: {
  path: string | null
  dirty: boolean
  onVerifiedSuccess: (path: string) => Promise<void> | void
}) {
  const controller = useRef<AbortController | null>(null)
  const [state, setState] = useState<ChangeState>(idle)

  const stop = useCallback(() => {
    const active = controller.current
    if (!active) return
    active.abort()
    controller.current = null
    setState({ running: false, progress: null, outcome: "Change cancelled." })
  }, [])

  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(async (task: string) => {
    if (controller.current) return
    if (!path) {
      setState({ running: false, progress: null, outcome: "Select a file before starting Change." })
      return
    }
    if (dirty) {
      setState({ running: false, progress: null, outcome: `Save ${path} before starting Change.` })
      return
    }

    const active = new AbortController()
    controller.current = active
    setState({ running: true, progress: "Starting Change…", outcome: null })
    let malformed = false
    let done = false
    let verified = false

    const accept = (event: ChangeEvent) => {
      if (event.type === "started") {
        setState((current) => ({ ...current, progress: `Working on ${typeof event.file === "string" ? event.file : path}.` }))
      } else if (event.type === "progress" && typeof event.text === "string") {
        const progress = event.text
        setState((current) => ({ ...current, progress }))
      } else if (event.type === "done") {
        done = true
        const receipt = event.receipt
        verified = Boolean(receipt && typeof receipt === "object" && (receipt as { success?: unknown }).success === true)
      }
    }

    try {
      const response = await fetch("/api/loom/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, task }),
        signal: active.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) throw new Error(`CHANGE_${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ""
      for (;;) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffered += decoder.decode(value, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try { accept(JSON.parse(line) as ChangeEvent) } catch { malformed = true }
        }
      }
      buffered += decoder.decode()
      if (buffered.trim()) {
        try { accept(JSON.parse(buffered) as ChangeEvent) } catch { malformed = true }
      }
      if (active.signal.aborted || controller.current !== active) return
      if (malformed || !done) {
        setState({ running: false, progress: null, outcome: "Change did not return a valid completion receipt." })
      } else if (!verified) {
        setState({ running: false, progress: null, outcome: "Change was not verified." })
      } else {
        await onVerifiedSuccess(path)
        if (active.signal.aborted || controller.current !== active) return
        setState({ running: false, progress: null, outcome: "Change applied and verified." })
      }
    } catch (error) {
      if (active.signal.aborted) return
      setState({ running: false, progress: null, outcome: error instanceof Error ? `Change failed: ${error.message}` : "Change failed." })
    } finally {
      if (controller.current === active) controller.current = null
    }
  }, [dirty, onVerifiedSuccess, path])

  return { ...state, start, stop }
}
