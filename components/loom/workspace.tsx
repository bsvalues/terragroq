"use client"

import { useCallback, useEffect, useState } from "react"

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

        {view === "edit" ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); void save() }
            }}
            spellCheck={false}
            placeholder="Pick a file on the left."
            className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs leading-5 outline-none"
          />
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
