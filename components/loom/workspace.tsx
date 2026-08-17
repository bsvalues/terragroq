"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"

// CodeMirror touches the DOM on construction, so it is loaded in the browser only.
const CodeEditor = dynamic(() => import("@/components/loom/code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <p className="p-3 font-mono text-xs text-muted-foreground">opening…</p>,
})

type Entry = { name: string; path: string; directory: boolean }
type OpenFile = { path: string; content: string; modifiedAt: string }

/** A lazily-expanded directory. Children load on first open so the whole repo is never walked. */
function TreeNode({
  entry,
  depth,
  activePath,
  onOpen,
}: {
  entry: Entry
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = useCallback(async () => {
    if (!entry.directory) return onOpen(entry.path)
    const next = !expanded
    setExpanded(next)
    if (next && children === null) {
      setLoading(true)
      try {
        const response = await fetch(`/api/loom/files?path=${encodeURIComponent(entry.path)}`, { cache: "no-store" })
        const payload = await response.json()
        setChildren(response.ok ? (payload.entries ?? []) : [])
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }, [entry, expanded, children, onOpen])

  const active = activePath === entry.path

  return (
    <li>
      <button
        type="button"
        onClick={() => void toggle()}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-xs hover:bg-muted/60 ${active ? "bg-muted font-medium" : ""}`}
      >
        <span aria-hidden className="w-3 shrink-0 text-muted-foreground">
          {entry.directory ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded ? (
        <ul>
          {loading ? <li className="py-1 pl-6 text-xs text-muted-foreground">…</li> : null}
          {(children ?? []).map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * Files, an editor, and the diff — the parts that make this a place to develop rather than a place
 * to read about development.
 *
 * The editor and the diff deliberately share one open file: the operator edits, saves, and sees what
 * actually changed against HEAD without moving to another surface or trusting a summary. Saving is
 * refused if the file changed underneath, because the agent may be editing the same tree.
 */
export function Workspace() {
  const [roots, setRoots] = useState<Entry[]>([])
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [draft, setDraft] = useState("")
  const [view, setView] = useState<"edit" | "diff">("edit")
  const [diff, setDiff] = useState<string>("")
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [task, setTask] = useState("")
  const [editing, setEditing] = useState(false)
  const [progress, setProgress] = useState<string[]>([])

  useEffect(() => {
    fetch("/api/loom/files?path=", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((payload) => setRoots(payload.entries ?? []))
      .catch(() => setRoots([]))
  }, [])

  const openFile = useCallback(async (path: string) => {
    setNote(null)
    try {
      const response = await fetch(`/api/loom/files?path=${encodeURIComponent(path)}`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) return setNote(payload.error ?? "could not open")
      if (payload.kind === "binary") { setOpen(null); return setNote(`${path} is binary`) }
      setOpen({ path: payload.path, content: payload.content, modifiedAt: payload.modifiedAt })
      setDraft(payload.content)
      setView("edit")
    } catch (error) {
      setNote(String(error))
    }
  }, [])

  const loadDiff = useCallback(async (path: string | null) => {
    const query = path ? `?path=${encodeURIComponent(path)}` : ""
    try {
      const response = await fetch(`/api/loom/diff${query}`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) return setDiff(`could not load diff: ${payload.error ?? response.status}`)
      setDiff(payload.untracked ? payload.note : payload.diff || "No changes against HEAD.")
    } catch (error) {
      setDiff(String(error))
    }
  }, [])

  useEffect(() => {
    if (view === "diff") void loadDiff(open?.path ?? null)
  }, [view, open?.path, loadDiff])

  const save = useCallback(async () => {
    if (!open || saving) return
    setSaving(true)
    setNote(null)
    try {
      const response = await fetch("/api/loom/files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: open.path, content: draft, modifiedAt: open.modifiedAt }),
      })
      const payload = await response.json()
      if (response.status === 409) {
        // Someone else -- almost certainly the agent -- wrote this file while it was open.
        setNote("This file changed on disk while you had it open. Reopen it before saving.")
        return
      }
      if (!response.ok) return setNote(payload.error ?? "could not save")
      setOpen({ ...open, content: draft, modifiedAt: payload.modifiedAt })
      setNote("saved")
    } catch (error) {
      setNote(String(error))
    } finally {
      setSaving(false)
    }
  }, [open, draft, saving])

  /**
   * Ask the local model to make a change, through the structured-edit adapter.
   *
   * The adapter restores the file if nothing verifies, so a failed attempt is a no-op rather than a
   * half-edited file. Afterwards the file is re-read from disk instead of trusting what was sent --
   * the point of watching an agent work is seeing what actually happened.
   */
  const runLocalEdit = useCallback(async () => {
    if (!open || editing || !task.trim()) return
    setEditing(true)
    setProgress([])
    setNote(null)
    try {
      const response = await fetch("/api/loom/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: open.path, task: task.trim() }),
      })
      if (!response.ok || !response.body) {
        setNote(`could not start the local edit (${response.status})`)
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let event: Record<string, unknown>
          try { event = JSON.parse(line) } catch { continue }
          if (event.type === "started") setProgress((c) => [...c, `working on ${String(event.file)} with ${String(event.model)}`])
          if (event.type === "progress" && typeof event.text === "string") setProgress((c) => [...c, event.text as string])
          if (event.type === "done") {
            const receipt = event.receipt as { success?: boolean; trace?: { events?: Array<Record<string, unknown>> } } | null
            const attempts = receipt?.trace?.events?.filter((entry) => entry.event === "model_call").length ?? 0
            setProgress((c) => [...c, receipt?.success
              ? `applied and verified after ${attempts} attempt${attempts === 1 ? "" : "s"}`
              : `nothing verified — the file was left unchanged${event.reason ? ` (${String(event.reason)})` : ""}`])
          }
        }
      }
      await openFile(open.path)
      setTask("")
    } catch (error) {
      setNote(String(error))
    } finally {
      setEditing(false)
    }
  }, [open, editing, task, openFile])

  const dirty = open !== null && draft !== open.content

  return (
    <section className="grid min-h-0 flex-1 grid-cols-[14rem_1fr] overflow-hidden rounded-lg border border-border">
      <nav className="min-h-0 overflow-auto border-r border-border bg-muted/20 py-2" aria-label="Files">
        <ul>
          {roots.map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} activePath={open?.path ?? null} onOpen={(path) => void openFile(path)} />
          ))}
        </ul>
      </nav>

      <div className="flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="truncate font-mono text-xs">{open?.path ?? "no file open"}</span>
          {dirty ? <span className="text-xs text-amber-600">● unsaved</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("edit")}
              className={`rounded px-2 py-1 text-xs ${view === "edit" ? "bg-muted font-medium" : ""}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setView("diff")}
              className={`rounded px-2 py-1 text-xs ${view === "diff" ? "bg-muted font-medium" : ""}`}
            >
              Diff
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {note ? <p className="border-b border-border px-3 py-1 text-xs text-amber-600">{note}</p> : null}

        {open ? (
          <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                value={task}
                onChange={(event) => setTask(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void runLocalEdit() }}
                disabled={editing}
                placeholder="Ask the local model to change this file…"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void runLocalEdit()}
                disabled={editing || !task.trim()}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
              >
                {editing ? "Working…" : "Local edit"}
              </button>
            </div>
            {progress.length > 0 ? (
              <p className="max-h-16 overflow-auto font-mono text-[11px] text-muted-foreground">
                {progress[progress.length - 1]}
              </p>
            ) : null}
          </div>
        ) : null}

        {view === "edit" ? (
          <div className="min-h-0 flex-1 overflow-auto">
            {open ? (
              <CodeEditor path={open.path} value={draft} onChange={setDraft} onSave={() => void save()} />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">Pick a file on the left.</p>
            )}
          </div>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">
            {(diff || "…").split("\n").map((line, index) => (
              <div
                key={index}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "text-green-500"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "text-red-400"
                      : line.startsWith("@@")
                        ? "text-sky-400"
                        : "text-muted-foreground"
                }
              >
                {line || " "}
              </div>
            ))}
          </pre>
        )}
      </div>
    </section>
  )
}
