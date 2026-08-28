"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Columns2, File, Folder, FolderOpen, Save, X } from "lucide-react"

import type { EditorPane, WorkspaceSpace } from "./types"
import styles from "./workspace-shell.module.css"

const SourceEditor = dynamic(() => import("./source-editor").then((module) => module.SourceEditor), {
  ssr: false,
  loading: () => <div className={styles.emptyEditor}>Opening editor…</div>,
})

type Entry = Readonly<{ name: string; path: string; directory: boolean }>
export type FileBuffer = Readonly<{
  path: string
  content: string
  savedContent: string
  modifiedAt: string
  saving: boolean
  error: string | null
}>

export function acknowledgeSavedBuffer(
  current: FileBuffer,
  submittedContent: string,
  modifiedAt: string,
): FileBuffer {
  return { ...current, savedContent: submittedContent, modifiedAt, saving: false, error: null }
}

function TreeNode({ entry, depth, selectedPath, onOpen }: {
  entry: Entry
  depth: number
  selectedPath: string | null
  onOpen: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<readonly Entry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function activate() {
    if (!entry.directory) return onOpen(entry.path)
    const next = !expanded
    setExpanded(next)
    if (!next || children !== null) return
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/loom/files?path=${encodeURIComponent(entry.path)}`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload.kind !== "directory") throw new Error(payload.error ?? `READ_${response.status}`)
      setChildren(payload.entries ?? [])
    } catch {
      setChildren([])
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <li>
      <button
        type="button"
        className={`${styles.treeEntry} ${selectedPath === entry.path ? styles.treeEntrySelected : ""}`}
        style={{ paddingLeft: depth * 13 + 8 }}
        onClick={() => void activate()}
        title={entry.path}
      >
        {entry.directory
          ? expanded ? <FolderOpen size={13} aria-hidden /> : <Folder size={13} aria-hidden />
          : <File size={12} aria-hidden />}
        <span>{entry.name}</span>
      </button>
      {expanded ? (
        <ul>
          {loading ? <li className={styles.treeNote} style={{ paddingLeft: depth * 13 + 25 }}>opening…</li> : null}
          {failed ? <li className={styles.treeError} style={{ paddingLeft: depth * 13 + 25 }}>directory unavailable</li> : null}
          {(children ?? []).map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function EditorSurface({ space, onEditorChange, onSelectedFileDirtyChange, reloadPath = null, reloadKey = 0, onReloadSettled }: {
  space: WorkspaceSpace
  onEditorChange: (editor: WorkspaceSpace["editor"], selectedPath: string | null) => void
  onSelectedFileDirtyChange?: (path: string, dirty: boolean) => void
  reloadPath?: string | null
  reloadKey?: number
  onReloadSettled?: (path: string, key: number, result: "refreshed" | "dirty-conflict" | "failed") => void
}) {
  const [roots, setRoots] = useState<readonly Entry[] | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({})
  const loadingFiles = useRef(new Set<string>())
  const dirtyBuffers = useRef(new Set<string>())
  const completedReloadKey = useRef(-1)
  const bufferEpoch = useRef(new Map<string, number>())

  const loadRoots = useCallback(async () => {
    setTreeError(null)
    try {
      const response = await fetch("/api/loom/files?path=", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload.kind !== "directory") throw new Error(payload.error ?? `READ_${response.status}`)
      setRoots(payload.entries ?? [])
    } catch (error) {
      setRoots([])
      setTreeError(error instanceof Error ? error.message : "WORKSPACE_UNAVAILABLE")
    }
  }, [])

  useEffect(() => { void loadRoots() }, [loadRoots])

  useEffect(() => {
    for (const path of space.editor.openFiles) {
      if (buffers[path] || loadingFiles.current.has(path)) continue
      loadingFiles.current.add(path)
      const epoch = bufferEpoch.current.get(path) ?? 0
      void fetch(`/api/loom/files?path=${encodeURIComponent(path)}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok || payload.kind !== "file") throw new Error(payload.error ?? `READ_${response.status}`)
          setBuffers((current) => (bufferEpoch.current.get(path) ?? 0) !== epoch ? current : ({ ...current, [path]: {
            path: payload.path,
            content: payload.content,
            savedContent: payload.content,
            modifiedAt: payload.modifiedAt,
            saving: false,
            error: null,
          } }))
        })
        .catch((error) => {
          if ((bufferEpoch.current.get(path) ?? 0) !== epoch) return
          setTreeError(error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        })
        .finally(() => loadingFiles.current.delete(path))
    }
  }, [buffers, space.editor.openFiles])

  useEffect(() => {
    if (!reloadPath || completedReloadKey.current === reloadKey) return
    const current = buffers[reloadPath]
    if (dirtyBuffers.current.has(reloadPath) || (current && current.content !== current.savedContent)) {
      completedReloadKey.current = reloadKey
      onReloadSettled?.(reloadPath, reloadKey, "dirty-conflict")
      return
    }
    completedReloadKey.current = reloadKey
    const epoch = (bufferEpoch.current.get(reloadPath) ?? 0) + 1
    bufferEpoch.current.set(reloadPath, epoch)
    void fetch(`/api/loom/files?path=${encodeURIComponent(reloadPath)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || payload.kind !== "file") throw new Error(payload.error ?? `READ_${response.status}`)
        if (bufferEpoch.current.get(reloadPath) !== epoch || dirtyBuffers.current.has(reloadPath)) return "dirty-conflict" as const
        setBuffers((existing) => (bufferEpoch.current.get(reloadPath) ?? 0) !== epoch ? existing : ({ ...existing, [reloadPath]: {
          path: payload.path,
          content: payload.content,
          savedContent: payload.content,
          modifiedAt: payload.modifiedAt,
          saving: false,
          error: null,
        } }))
        return "refreshed" as const
      })
      .then((result) => onReloadSettled?.(reloadPath, reloadKey, result))
      .catch((error) => {
        setTreeError(error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        onReloadSettled?.(reloadPath, reloadKey, "failed")
      })
  }, [buffers, onReloadSettled, reloadKey, reloadPath])

  const selectedBuffer = space.selectedPath ? buffers[space.selectedPath] : null
  useEffect(() => {
    if (!space.selectedPath) return
    onSelectedFileDirtyChange?.(space.selectedPath, Boolean(selectedBuffer && selectedBuffer.content !== selectedBuffer.savedContent))
  }, [onSelectedFileDirtyChange, selectedBuffer?.content, selectedBuffer?.savedContent, space.selectedPath])

  const updatePanes = useCallback((
    panes: readonly EditorPane[],
    openFiles = space.editor.openFiles,
    selectedPath = space.selectedPath,
    activePaneId = space.editor.activePaneId,
  ) => {
    onEditorChange({ openFiles, panes, activePaneId }, selectedPath)
  }, [onEditorChange, space.editor.activePaneId, space.editor.openFiles, space.selectedPath])

  const openFile = useCallback(async (path: string, targetPaneId: EditorPane["id"] = space.editor.activePaneId) => {
    if (!buffers[path]) {
      try {
        const epoch = bufferEpoch.current.get(path) ?? 0
        const response = await fetch(`/api/loom/files?path=${encodeURIComponent(path)}`, { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error ?? `READ_${response.status}`)
        if (payload.kind === "binary") throw new Error("BINARY_FILE_NOT_EDITABLE")
        setBuffers((current) => (bufferEpoch.current.get(path) ?? 0) !== epoch ? current : ({ ...current, [path]: {
          path: payload.path,
          content: payload.content,
          savedContent: payload.content,
          modifiedAt: payload.modifiedAt,
          saving: false,
          error: null,
        } }))
      } catch (error) {
        setTreeError(error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        return
      }
    }
    const openFiles = space.editor.openFiles.includes(path) ? space.editor.openFiles : [...space.editor.openFiles, path]
    const panes = space.editor.panes.map((pane) => pane.id === targetPaneId ? { ...pane, activePath: path, selection: null } : pane)
    updatePanes(panes, openFiles, path, targetPaneId)
  }, [buffers, space.editor.activePaneId, space.editor.openFiles, space.editor.panes, updatePanes])

  const save = useCallback(async (path: string) => {
    const buffer = buffers[path]
    if (!buffer || buffer.saving || buffer.content === buffer.savedContent) return
    const submittedContent = buffer.content
    setBuffers((current) => ({ ...current, [path]: { ...current[path], saving: true, error: null } }))
    try {
      const response = await fetch("/api/loom/files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, content: submittedContent, modifiedAt: buffer.modifiedAt }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = [payload.error ?? `SAVE_${response.status}`, payload.detail].filter(Boolean).join(": ")
        throw new Error(payload.error === "CHANGED_ON_DISK" ? "CHANGED_ON_DISK: reopen before saving" : detail)
      }
      setBuffers((current) => {
        const acknowledged = acknowledgeSavedBuffer(current[path], submittedContent, payload.modifiedAt)
        if (acknowledged.content === acknowledged.savedContent) dirtyBuffers.current.delete(path)
        else dirtyBuffers.current.add(path)
        return { ...current, [path]: acknowledged }
      })
    } catch (error) {
      setBuffers((current) => ({ ...current, [path]: {
        ...current[path], saving: false, error: error instanceof Error ? error.message : "SAVE_REFUSED",
      } }))
    }
  }, [buffers])

  const split = useCallback(() => {
    if (space.editor.panes.length > 1) return
    const primary = space.editor.panes[0]
    updatePanes([...space.editor.panes, { id: "secondary", activePath: primary?.activePath ?? null, selection: primary?.selection ?? null }], space.editor.openFiles, primary?.activePath ?? null, "secondary")
  }, [space.editor.openFiles, space.editor.panes, updatePanes])

  const closeTab = useCallback((path: string) => {
    const openFiles = space.editor.openFiles.filter((open) => open !== path)
    const replacement = openFiles.at(-1) ?? null
    const panes = space.editor.panes.map((pane) => pane.activePath === path ? { ...pane, activePath: replacement, selection: null } : pane)
    updatePanes(panes, openFiles, replacement)
  }, [space.editor.openFiles, space.editor.panes, updatePanes])

  return (
    <div className={styles.editorSurface}>
      <nav className={styles.fileTree} aria-label="Workspace files">
        <div className={styles.fileTreeName}>TERRAFUSION</div>
        {treeError ? <div className={styles.inlineRefusal} role="alert">{treeError}</div> : null}
        <ul>
          {(roots ?? []).map((entry) => (
            <TreeNode key={entry.path} entry={entry} depth={0} selectedPath={space.selectedPath} onOpen={(path) => void openFile(path)} />
          ))}
        </ul>
      </nav>
      <div className={styles.editorWorkarea}>
        <div className={styles.editorActions}>
          <button type="button" onClick={split} disabled={space.editor.panes.length > 1} title="Split editor" aria-label="Split editor">
            <Columns2 size={14} />
          </button>
          <span className={styles.editorHint}>Ctrl+S save · Ctrl+Z undo · Ctrl+Y redo</span>
        </div>
        <div className={styles.panes} data-split={space.editor.panes.length > 1}>
          {space.editor.panes.map((pane) => {
            const buffer = pane.activePath ? buffers[pane.activePath] : null
            return (
              <div
                key={pane.id}
                className={`${styles.pane} ${space.editor.activePaneId === pane.id ? styles.activePane : ""}`}
                onPointerDown={() => updatePanes(space.editor.panes, space.editor.openFiles, pane.activePath, pane.id)}
              >
                <div className={styles.tabs} role="tablist" aria-label={`${pane.id} editor tabs`}>
                  {space.editor.openFiles.map((path) => {
                    const dirty = buffers[path] ? buffers[path].content !== buffers[path].savedContent : false
                    return (
                      <div key={path} className={`${styles.tabItem} ${pane.activePath === path ? styles.activeTab : ""}`} role="presentation">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={pane.activePath === path}
                          className={styles.tab}
                          onClick={() => {
                            const panes = space.editor.panes.map((item) => item.id === pane.id ? { ...item, activePath: path } : item)
                            updatePanes(panes, space.editor.openFiles, path, pane.id)
                            if (!buffers[path]) void openFile(path, pane.id)
                          }}
                        >
                          <span>{path.split("/").at(-1)}</span>
                          {dirty ? <span className={styles.dirtyMark} aria-label="Unsaved">●</span> : null}
                        </button>
                        <button
                          type="button"
                          className={styles.closeTab}
                          aria-label={`Close ${path}`}
                          onClick={() => closeTab(path)}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className={styles.editorCanvas}>
                  {buffer ? (
                    <>
                      <SourceEditor
                        path={buffer.path}
                        value={buffer.content}
                        selection={pane.selection}
                        onChange={(content) => {
                          bufferEpoch.current.set(buffer.path, (bufferEpoch.current.get(buffer.path) ?? 0) + 1)
                          if (content === buffer.savedContent) dirtyBuffers.current.delete(buffer.path)
                          else dirtyBuffers.current.add(buffer.path)
                          setBuffers((current) => ({ ...current, [buffer.path]: { ...current[buffer.path], content, error: null } }))
                        }}
                        onSelection={(selection) => {
                          const panes = space.editor.panes.map((item) => item.id === pane.id ? { ...item, selection } : item)
                          updatePanes(panes, space.editor.openFiles, buffer.path, pane.id)
                        }}
                        onSave={() => void save(buffer.path)}
                      />
                      <div className={styles.editorFooter}>
                        <span className={buffer.error ? styles.saveError : ""}>{buffer.error ?? buffer.path}</span>
                        <button
                          type="button"
                          onClick={() => void save(buffer.path)}
                          disabled={buffer.saving || buffer.content === buffer.savedContent}
                          aria-label={`Save ${buffer.path}`}
                        >
                          <Save size={12} /> {buffer.saving ? "Saving" : "Save"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className={styles.emptyEditor}>
                      <span>{roots === null ? "Mounting workspace…" : "Open a file"}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
