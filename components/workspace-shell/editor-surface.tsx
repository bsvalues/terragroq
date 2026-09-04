"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Columns2, File, Folder, FolderOpen, Save, X } from "lucide-react"

import { canonicalWorkspaceObjectKey, parseWorkspaceFileRef, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"
import type { WorkspaceRepositoryMountView } from "@/lib/projects/core-seven-repositories"
import { RepositoryShelf, type RepositoryShelfRepository } from "./repository-shelf"
import type { EditorPane, WorkspaceProject, WorkspaceSpace } from "./types"
import styles from "./workspace-shell.module.css"

const SourceEditor = dynamic(() => import("./source-editor").then((module) => module.SourceEditor), {
  ssr: false,
  loading: () => <div className={styles.emptyEditor}>Opening editor…</div>,
})

type Entry = Readonly<{ name: string; path: string; directory: boolean }>
type WorkspaceProjectKey = "terrafusion" | "williamos"
const ROOT_ENTRY_BATCH_SIZE = 32

function fileEndpoint(path: string, projectKey: WorkspaceProjectKey, repositoryKey?: string | null): string {
  const query = new URLSearchParams({ path })
  if (projectKey === "williamos") query.set("projectKey", "williamos")
  if (repositoryKey) query.set("repositoryKey", repositoryKey)
  return `/api/loom/files?${query.toString()}`
}
export type FileBuffer = Readonly<{
  key: string
  path: string
  fileRef: WorkspaceFileRef | null
  repositoryKey: string | null
  content: string
  savedContent: string
  modifiedAt: string
  saving: boolean
  error: string | null
}>

type OpenFile = Readonly<{ key: string; path: string; fileRef: WorkspaceFileRef | null; repositoryKey: string | null }>
type StaleFileRecovery = Readonly<{
  staleKey: string
  path: string
  repositoryKey: string | null
  fileRef: WorkspaceFileRef
  content: string
  modifiedAt: string
}>

function repositoryForKey(project: WorkspaceProject | undefined, key: string | null | undefined): WorkspaceRepositoryMountView | null {
  return project?.repositories?.find((repository) => repository.key === key) ?? null
}

function defaultRepository(project: WorkspaceProject | undefined): WorkspaceRepositoryMountView | null {
  return project?.repositories?.find((repository) => repository.defaultRepository)
    ?? project?.repositories?.find((repository) => repository.mount.verified)
    ?? null
}

function workspaceFileRef(project: WorkspaceProject, repository: WorkspaceRepositoryMountView, path: string): WorkspaceFileRef | null {
  if (!repository.mount.verified || !repository.mount.revision) return null
  return {
    projectIdentity: project.identity,
    repositoryResourceKey: repository.key,
    repositoryMountKey: repository.mount.key,
    worktreeKey: null,
    observedRevision: repository.mount.revision,
    path,
  }
}

function responseWorkspaceFileRef(
  project: WorkspaceProject,
  repository: WorkspaceRepositoryMountView | null,
  requestedPath: string,
  payload: Readonly<Record<string, unknown>>,
): WorkspaceFileRef {
  const responseRepository = payload.repository
  if (!responseRepository || typeof responseRepository !== "object" || Array.isArray(responseRepository)
    || payload.path !== requestedPath) {
    throw new Error("WORKSPACE_FILE_REF_RESPONSE_MISMATCH")
  }
  const identity = responseRepository as Record<string, unknown>
  if (repository && (identity.key !== repository.key || identity.identity !== repository.identity
    || identity.mountKey !== repository.mount.key)) {
    throw new Error("WORKSPACE_FILE_REF_RESPONSE_MISMATCH")
  }
  try {
    return parseWorkspaceFileRef({
      projectIdentity: project.identity,
      repositoryResourceKey: identity.key,
      repositoryMountKey: identity.mountKey,
      worktreeKey: null,
      observedRevision: identity.observedRevision,
      path: payload.path,
    })
  } catch {
    throw new Error("WORKSPACE_FILE_REF_RESPONSE_MISMATCH")
  }
}

function openFilesForSpace(space: WorkspaceSpace, project: WorkspaceProject | undefined): readonly OpenFile[] {
  const refs = space.editor.openFileRefs ?? []
  if (refs.length > 0) return refs.map((fileRef) => ({
    key: canonicalWorkspaceObjectKey(fileRef),
    path: fileRef.path,
    fileRef,
    repositoryKey: fileRef.repositoryResourceKey,
  }))
  const repository = defaultRepository(project)
  return space.editor.openFiles.map((path) => {
    const fileRef = repository && project ? workspaceFileRef(project, repository, path) : null
    return {
      key: fileRef ? canonicalWorkspaceObjectKey(fileRef) : path,
      path,
      fileRef,
      repositoryKey: repository?.key ?? null,
    }
  })
}

export function acknowledgeSavedBuffer(
  current: FileBuffer,
  submittedContent: string,
  modifiedAt: string,
): FileBuffer {
  return { ...current, savedContent: submittedContent, modifiedAt, saving: false, error: null }
}

function TreeNode({ entry, depth, selectedPath, projectKey, repositoryKey, onOpen, selectedFileRef, projectIdentity, repositoryMountKey }: {
  entry: Entry
  depth: number
  selectedPath: string | null
  projectKey: WorkspaceProjectKey
  repositoryKey: string | null
  onOpen: (path: string) => void
  selectedFileRef?: WorkspaceFileRef | null
  projectIdentity?: string | null
  repositoryMountKey?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<readonly Entry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = selectedFileRef
    ? selectedFileRef.projectIdentity === projectIdentity
      && selectedFileRef.repositoryResourceKey === repositoryKey
      && selectedFileRef.repositoryMountKey === repositoryMountKey
      && selectedFileRef.worktreeKey === null
      && selectedFileRef.path === entry.path
    : selectedPath === entry.path

  async function activate() {
    if (!entry.directory) return onOpen(entry.path)
    const next = !expanded
    setExpanded(next)
    if (!next || children !== null) return
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch(fileEndpoint(entry.path, projectKey, repositoryKey), { cache: "no-store" })
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
        className={`${styles.treeEntry} ${selected ? styles.treeEntrySelected : ""}`}
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
            <TreeNode key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} projectKey={projectKey} repositoryKey={repositoryKey} onOpen={onOpen} selectedFileRef={selectedFileRef} projectIdentity={projectIdentity} repositoryMountKey={repositoryMountKey} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function EditorSurface({ project, projectName = project?.name ?? "Project", projectKey = "terrafusion", requestedRepositoryKey = null, space, onEditorChange, onSelectedFileDirtyChange, reloadPath = null, reloadKey = 0, onReloadSettled }: {
  project?: WorkspaceProject
  projectName?: string
  projectKey?: WorkspaceProjectKey
  requestedRepositoryKey?: string | null
  space: WorkspaceSpace
  onEditorChange: (editor: WorkspaceSpace["editor"], selectedPath: string | null, selectedFileRef?: WorkspaceFileRef | null) => void
  onSelectedFileDirtyChange?: (path: string, dirty: boolean, fileRef?: WorkspaceFileRef | null) => void
  reloadPath?: string | null
  reloadKey?: number
  onReloadSettled?: (path: string, key: number, result: "refreshed" | "dirty-conflict" | "failed") => void
}) {
  const preferredInitialRepository = repositoryForKey(project, space.editor.activeRepositoryKey)
    ?? repositoryForKey(project, space.selectedFileRef?.repositoryResourceKey)
    ?? defaultRepository(project)
  const initialRepository = preferredInitialRepository
    && (space.editor.workingSetRepositoryKeys === undefined
      || preferredInitialRepository.defaultRepository
      || space.editor.workingSetRepositoryKeys.includes(preferredInitialRepository.key))
    ? preferredInitialRepository
    : defaultRepository(project)
  const [activeRepositoryKey, setActiveRepositoryKey] = useState<string | null>(initialRepository?.key ?? null)
  const [rootsByRepository, setRootsByRepository] = useState<Record<string, readonly Entry[] | null>>({})
  const [visibleRootCount, setVisibleRootCount] = useState(ROOT_ENTRY_BATCH_SIZE)
  const [treeErrorsByRepository, setTreeErrorsByRepository] = useState<Record<string, string | undefined>>({})
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({})
  const [staleFileRecoveries, setStaleFileRecoveries] = useState<Record<string, StaleFileRecovery>>({})
  const loadingFiles = useRef(new Set<string>())
  const dirtyBuffers = useRef(new Set<string>())
  const completedReloadKey = useRef(-1)
  const bufferEpoch = useRef(new Map<string, number>())

  const activeRepository = repositoryForKey(project, activeRepositoryKey)
  const activeRootsKey = activeRepository?.key ?? "legacy"
  const roots = rootsByRepository[activeRootsKey] ?? null
  const treeError = treeErrorsByRepository[activeRootsKey] ?? null
  const openFiles = openFilesForSpace(space, project)
  const effectiveWorkingSetKeys = useMemo(() => {
    const repositories = project?.repositories ?? []
    const knownCoreKeys = new Set(repositories
      .filter((repository) => repository.role !== "attached-source")
      .map((repository) => repository.key))
    const requested = space.editor.workingSetRepositoryKeys === undefined
      ? [
        ...repositories.filter((repository) => repository.defaultRepository).map((repository) => repository.key),
        ...openFiles.flatMap((openFile) => openFile.repositoryKey ? [openFile.repositoryKey] : []),
      ]
      : [...space.editor.workingSetRepositoryKeys]
    for (const repository of repositories) if (repository.defaultRepository) requested.unshift(repository.key)
    return [...new Set(requested)].filter((key) => knownCoreKeys.has(key))
  }, [openFiles, project?.repositories, space.editor.workingSetRepositoryKeys])

  const clearTreeError = useCallback((repositoryKey: string | null) => {
    const key = repositoryKey ?? "legacy"
    setTreeErrorsByRepository((current) => current[key] === undefined ? current : { ...current, [key]: undefined })
  }, [])

  const setTreeError = useCallback((repositoryKey: string | null, message: string) => {
    const key = repositoryKey ?? "legacy"
    setTreeErrorsByRepository((current) => current[key] === message ? current : { ...current, [key]: message })
  }, [])

  useEffect(() => {
    setVisibleRootCount(ROOT_ENTRY_BATCH_SIZE)
  }, [activeRootsKey])

  const loadRoots = useCallback(async (repositoryKey = activeRepositoryKey) => {
    clearTreeError(repositoryKey)
    const repository = repositoryForKey(project, repositoryKey)
    if (repository && !repository.mount.verified) {
      setRootsByRepository((current) => ({ ...current, [repository.key]: [] }))
      setTreeError(repository.key, repository.mount.refusal ?? "WORKSPACE_REPOSITORY_MOUNT_UNAVAILABLE")
      return
    }
    try {
      const response = await fetch(fileEndpoint("", projectKey, repository?.key ?? null), { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload.kind !== "directory") throw new Error(payload.error ?? `READ_${response.status}`)
      setRootsByRepository((current) => ({ ...current, [repository?.key ?? "legacy"]: payload.entries ?? [] }))
      clearTreeError(repository?.key ?? null)
    } catch (error) {
      setRootsByRepository((current) => ({ ...current, [repository?.key ?? "legacy"]: [] }))
      setTreeError(repository?.key ?? null, error instanceof Error ? error.message : "WORKSPACE_UNAVAILABLE")
    }
  }, [activeRepositoryKey, clearTreeError, project, projectKey, setTreeError])

  useEffect(() => { void loadRoots(activeRepositoryKey) }, [activeRepositoryKey, loadRoots])
  useEffect(() => {
    if (requestedRepositoryKey && repositoryForKey(project, requestedRepositoryKey)?.mount.verified) {
      clearTreeError(requestedRepositoryKey)
      setActiveRepositoryKey(requestedRepositoryKey)
    }
  }, [clearTreeError, project, requestedRepositoryKey])

  useEffect(() => {
    for (const openFile of openFiles) {
      if (buffers[openFile.key] || loadingFiles.current.has(openFile.key)) continue
      loadingFiles.current.add(openFile.key)
      const epoch = bufferEpoch.current.get(openFile.key) ?? 0
      void fetch(fileEndpoint(openFile.path, projectKey, openFile.repositoryKey), { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok || payload.kind !== "file") throw new Error(payload.error ?? `READ_${response.status}`)
          const repository = repositoryForKey(project, openFile.repositoryKey)
          const responseFileRef = project && (repository || payload.repository)
            ? responseWorkspaceFileRef(project, repository, openFile.path, payload)
            : openFile.fileRef
          if (openFile.fileRef && responseFileRef
            && responseFileRef.observedRevision !== openFile.fileRef.observedRevision) {
            setStaleFileRecoveries((current) => ({ ...current, [openFile.key]: {
              staleKey: openFile.key,
              path: payload.path,
              repositoryKey: openFile.repositoryKey,
              fileRef: responseFileRef,
              content: payload.content,
              modifiedAt: payload.modifiedAt,
            } }))
            throw new Error("WORKSPACE_FILE_REF_STALE")
          }
          setBuffers((current) => (bufferEpoch.current.get(openFile.key) ?? 0) !== epoch ? current : ({ ...current, [openFile.key]: {
            key: openFile.key,
            path: payload.path,
            fileRef: responseFileRef,
            repositoryKey: openFile.repositoryKey,
            content: payload.content,
            savedContent: payload.content,
            modifiedAt: payload.modifiedAt,
            saving: false,
            error: null,
          } }))
        })
        .catch((error) => {
          if ((bufferEpoch.current.get(openFile.key) ?? 0) !== epoch) return
          setTreeError(openFile.repositoryKey, error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        })
        .finally(() => loadingFiles.current.delete(openFile.key))
    }
  }, [buffers, openFiles, project, projectKey, setTreeError])

  useEffect(() => {
    if (!reloadPath || completedReloadKey.current === reloadKey) return
    const target = openFiles.find((openFile) => openFile.path === reloadPath
      && (!space.selectedFileRef || canonicalWorkspaceObjectKey(space.selectedFileRef) === openFile.key))
      ?? openFiles.find((openFile) => openFile.path === reloadPath)
    const targetKey = target?.key ?? reloadPath
    const current = buffers[targetKey]
    if (dirtyBuffers.current.has(targetKey) || (current && current.content !== current.savedContent)) {
      completedReloadKey.current = reloadKey
      onReloadSettled?.(reloadPath, reloadKey, "dirty-conflict")
      return
    }
    completedReloadKey.current = reloadKey
    const epoch = (bufferEpoch.current.get(targetKey) ?? 0) + 1
    bufferEpoch.current.set(targetKey, epoch)
    void fetch(fileEndpoint(reloadPath, projectKey, target?.repositoryKey ?? null), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok || payload.kind !== "file") throw new Error(payload.error ?? `READ_${response.status}`)
        const repository = repositoryForKey(project, target?.repositoryKey)
        const responseFileRef = project && (repository || payload.repository)
          ? responseWorkspaceFileRef(project, repository, reloadPath, payload)
          : target?.fileRef ?? null
        if (target?.fileRef && responseFileRef
          && responseFileRef.observedRevision !== target.fileRef.observedRevision) {
          setStaleFileRecoveries((existing) => ({ ...existing, [targetKey]: {
            staleKey: targetKey,
            path: payload.path,
            repositoryKey: target.repositoryKey,
            fileRef: responseFileRef,
            content: payload.content,
            modifiedAt: payload.modifiedAt,
          } }))
          throw new Error("WORKSPACE_FILE_REF_STALE")
        }
        if (bufferEpoch.current.get(targetKey) !== epoch || dirtyBuffers.current.has(targetKey)) return "dirty-conflict" as const
        setBuffers((existing) => (bufferEpoch.current.get(targetKey) ?? 0) !== epoch ? existing : ({ ...existing, [targetKey]: {
          key: targetKey,
          path: payload.path,
          fileRef: responseFileRef,
          repositoryKey: target?.repositoryKey ?? null,
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
        setTreeError(target?.repositoryKey ?? null, error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        onReloadSettled?.(reloadPath, reloadKey, "failed")
      })
  }, [buffers, onReloadSettled, openFiles, project, projectKey, reloadKey, reloadPath, setTreeError, space.selectedFileRef])

  const selectedKey = space.selectedFileRef ? canonicalWorkspaceObjectKey(space.selectedFileRef) : space.selectedPath
  const selectedBuffer = selectedKey ? buffers[selectedKey] : null

  useEffect(() => {
    if (!space.selectedPath) return
    onSelectedFileDirtyChange?.(
      space.selectedPath,
      Boolean(selectedBuffer && selectedBuffer.content !== selectedBuffer.savedContent),
      selectedBuffer?.fileRef ?? space.selectedFileRef,
    )
  }, [onSelectedFileDirtyChange, selectedBuffer?.content, selectedBuffer?.fileRef, selectedBuffer?.savedContent, space.selectedFileRef, space.selectedPath])

  const updatePanes = useCallback((
    panes: readonly EditorPane[],
    nextOpenFiles = space.editor.openFiles,
    openFileRefs = space.editor.openFileRefs,
    selectedPath = space.selectedPath,
    activePaneId = space.editor.activePaneId,
    selectedFileRef = space.selectedFileRef,
    activeRepositoryOverride = activeRepositoryKey,
  ) => {
    onEditorChange({
      ...space.editor,
      openFiles: nextOpenFiles,
      ...(openFileRefs ? { openFileRefs } : {}),
      panes,
      activePaneId,
      activeRepositoryKey: activeRepositoryOverride,
    }, selectedPath, selectedFileRef)
  }, [activeRepositoryKey, onEditorChange, space.editor, space.selectedFileRef, space.selectedPath])

  const reopenStaleFile = useCallback((recovery: StaleFileRecovery) => {
    const currentKey = canonicalWorkspaceObjectKey(recovery.fileRef)
    bufferEpoch.current.set(recovery.staleKey, (bufferEpoch.current.get(recovery.staleKey) ?? 0) + 1)
    setBuffers((current) => ({ ...current, [currentKey]: {
      key: currentKey,
      path: recovery.path,
      fileRef: recovery.fileRef,
      repositoryKey: recovery.repositoryKey,
      content: recovery.content,
      savedContent: recovery.content,
      modifiedAt: recovery.modifiedAt,
      saving: false,
      error: null,
    } }))
    const replaceRef = (fileRef: WorkspaceFileRef | null | undefined) => fileRef
      && canonicalWorkspaceObjectKey(fileRef) === recovery.staleKey ? recovery.fileRef : fileRef
    const panes = space.editor.panes.map((pane) => ({ ...pane, activeFileRef: replaceRef(pane.activeFileRef) }))
    const selectedFileRef = replaceRef(space.selectedFileRef) ?? null
    const openFileRefs = space.editor.openFileRefs?.map((fileRef) => replaceRef(fileRef) as WorkspaceFileRef)
    setStaleFileRecoveries((current) => {
      const next = { ...current }
      delete next[recovery.staleKey]
      return next
    })
    clearTreeError(recovery.repositoryKey)
    updatePanes(
      panes,
      space.editor.openFiles,
      openFileRefs,
      space.selectedPath,
      space.editor.activePaneId,
      selectedFileRef,
      recovery.repositoryKey,
    )
  }, [clearTreeError, space, updatePanes])

  const persistRepositoryState = useCallback((workingSetRepositoryKeys: readonly string[], activeKey: string | null) => {
    onEditorChange({ ...space.editor, workingSetRepositoryKeys, activeRepositoryKey: activeKey }, space.selectedPath, space.selectedFileRef)
  }, [onEditorChange, space.editor, space.selectedFileRef, space.selectedPath])

  const selectRepository = useCallback((repositoryKey: string) => {
    clearTreeError(repositoryKey)
    setActiveRepositoryKey(repositoryKey)
    persistRepositoryState(effectiveWorkingSetKeys, repositoryKey)
  }, [clearTreeError, effectiveWorkingSetKeys, persistRepositoryState])

  const toggleWorkingSet = useCallback((repositoryKey: string, included: boolean) => {
    const repository = repositoryForKey(project, repositoryKey)
    if (!repository || repository.role === "attached-source" || repository.defaultRepository
      || included && !repository.mount.verified) return
    const requested = new Set(effectiveWorkingSetKeys)
    if (included) requested.add(repositoryKey)
    else requested.delete(repositoryKey)
    const ordered = (project?.repositories ?? [])
      .filter((candidate) => candidate.defaultRepository || requested.has(candidate.key))
      .map((candidate) => candidate.key)
    const nextActiveKey = !included && activeRepositoryKey === repositoryKey
      ? defaultRepository(project)?.key ?? null
      : activeRepositoryKey
    if (nextActiveKey !== activeRepositoryKey) {
      setActiveRepositoryKey(nextActiveKey)
      if (nextActiveKey) void loadRoots(nextActiveKey)
    }
    persistRepositoryState(ordered, nextActiveKey)
  }, [activeRepositoryKey, effectiveWorkingSetKeys, loadRoots, persistRepositoryState, project])

  const openFile = useCallback(async (
    path: string,
    targetPaneId: EditorPane["id"] = space.editor.activePaneId,
    targetRepositoryKey: string | null = activeRepositoryKey,
  ) => {
    const repository = repositoryForKey(project, targetRepositoryKey)
    const requestedFileRef = repository && project ? workspaceFileRef(project, repository, path) : null
    const key = requestedFileRef ? canonicalWorkspaceObjectKey(requestedFileRef) : path
    let fileRef = buffers[key]?.fileRef ?? requestedFileRef
    if (!buffers[key]) {
      try {
        const epoch = bufferEpoch.current.get(key) ?? 0
        const response = await fetch(fileEndpoint(path, projectKey, repository?.key ?? null), { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error ?? `READ_${response.status}`)
        if (payload.kind === "binary") throw new Error("BINARY_FILE_NOT_EDITABLE")
        fileRef = project && (repository || payload.repository)
          ? responseWorkspaceFileRef(project, repository, path, payload)
          : null
        const resolvedKey = fileRef ? canonicalWorkspaceObjectKey(fileRef) : key
        setBuffers((current) => (bufferEpoch.current.get(key) ?? 0) !== epoch ? current : ({ ...current, [resolvedKey]: {
          key: resolvedKey,
          path: payload.path,
          fileRef,
          repositoryKey: repository?.key ?? null,
          content: payload.content,
          savedContent: payload.content,
          modifiedAt: payload.modifiedAt,
          saving: false,
          error: null,
        } }))
      } catch (error) {
        setTreeError(repository?.key ?? null, error instanceof Error ? error.message : "FILE_UNAVAILABLE")
        return
      }
    }
    const currentOpen = openFilesForSpace(space, project)
    const nextOpen = currentOpen.some((open) => open.key === key) ? currentOpen : [...currentOpen, { key, path, fileRef, repositoryKey: repository?.key ?? null }]
    const panes = space.editor.panes.map((pane) => pane.id === targetPaneId
      ? { ...pane, activePath: path, activeFileRef: fileRef, selection: null }
      : pane)
    updatePanes(
      panes,
      nextOpen.map((open) => open.path),
      nextOpen.flatMap((open) => open.fileRef ? [open.fileRef] : []),
      path,
      targetPaneId,
      fileRef,
      repository?.key ?? activeRepositoryKey,
    )
  }, [activeRepositoryKey, buffers, project, projectKey, setTreeError, space, updatePanes])

  const save = useCallback(async (key: string) => {
    const buffer = buffers[key]
    if (!buffer || buffer.saving || buffer.content === buffer.savedContent) return
    const submittedContent = buffer.content
    if (!buffer.fileRef) {
      setBuffers((current) => ({ ...current, [key]: { ...current[key], error: "WORKSPACE_FILE_REF_REQUIRED" } }))
      return
    }
    setBuffers((current) => ({ ...current, [key]: { ...current[key], saving: true, error: null } }))
    try {
      const response = await fetch("/api/loom/files", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectKey, fileRef: buffer.fileRef, content: submittedContent, modifiedAt: buffer.modifiedAt }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = [payload.error ?? `SAVE_${response.status}`, payload.detail].filter(Boolean).join(": ")
        throw new Error(payload.error === "CHANGED_ON_DISK" ? "CHANGED_ON_DISK: reopen before saving" : detail)
      }
      setBuffers((current) => {
        const acknowledged = acknowledgeSavedBuffer(current[key], submittedContent, payload.modifiedAt)
        if (acknowledged.content === acknowledged.savedContent) dirtyBuffers.current.delete(key)
        else dirtyBuffers.current.add(key)
        return { ...current, [key]: acknowledged }
      })
    } catch (error) {
      setBuffers((current) => ({ ...current, [key]: {
        ...current[key], saving: false, error: error instanceof Error ? error.message : "SAVE_REFUSED",
      } }))
    }
  }, [buffers, projectKey])

  const split = useCallback(() => {
    if (space.editor.panes.length > 1) return
    const primary = space.editor.panes[0]
    updatePanes([...space.editor.panes, { id: "secondary", activePath: primary?.activePath ?? null, activeFileRef: primary?.activeFileRef ?? null, selection: primary?.selection ?? null }], space.editor.openFiles, space.editor.openFileRefs, primary?.activePath ?? null, "secondary", primary?.activeFileRef ?? null)
  }, [space.editor.openFileRefs, space.editor.openFiles, space.editor.panes, updatePanes])

  const closeTab = useCallback((key: string) => {
    const currentOpen = openFilesForSpace(space, project)
    const nextOpen = currentOpen.filter((open) => open.key !== key)
    const replacement = nextOpen.at(-1) ?? null
    const target = currentOpen.find((open) => open.key === key)
    const closesSelectedFile = Boolean(target && (
      space.selectedFileRef
        ? canonicalWorkspaceObjectKey(space.selectedFileRef) === key
        : space.selectedPath === target.path
    ))
    const replacementRepositoryKey = replacement?.repositoryKey ?? defaultRepository(project)?.key ?? null
    const panes = space.editor.panes.map((pane) => {
      const paneKey = pane.activeFileRef ? canonicalWorkspaceObjectKey(pane.activeFileRef) : pane.activePath
      return paneKey === key ? { ...pane, activePath: replacement?.path ?? null, activeFileRef: replacement?.fileRef ?? null, selection: null } : pane
    })
    if (closesSelectedFile) setActiveRepositoryKey(replacementRepositoryKey)
    updatePanes(panes, nextOpen.map((open) => open.path), nextOpen.flatMap((open) => open.fileRef ? [open.fileRef] : []),
      closesSelectedFile ? replacement?.path ?? null : space.selectedPath,
      space.editor.activePaneId,
      closesSelectedFile ? replacement?.fileRef ?? null : space.selectedFileRef,
      closesSelectedFile ? replacementRepositoryKey : activeRepositoryKey)
  }, [activeRepositoryKey, project, space, updatePanes])

  const shelfRepositories = useMemo<readonly RepositoryShelfRepository[]>(() => (project?.repositories ?? []).map((repository) => {
    const verified = repository.mount.verified && Boolean(repository.mount.revision)
    const active = repository.key === activeRepositoryKey
    const inWorkingSet = effectiveWorkingSetKeys.includes(repository.key)
    return {
      repositoryKey: repository.key,
      name: repository.label,
      canonicalIdentity: repository.identity,
      role: repository.role,
      ...(repository.suite ? { suite: repository.suite } : {}),
      workingSet: inWorkingSet,
      active,
      readOnly: !verified,
      preview: repository.previewSource ? "source" : "none",
      mounts: repository.mount.configured ? [{
        id: repository.mount.key,
        node: "Current host",
        label: verified ? "verified checkout" : "configured mount",
        branch: repository.mount.branch ?? "branch unavailable",
        revision: repository.mount.revision ?? repository.mount.refusal ?? "revision unavailable",
        status: verified ? "ready" : "unavailable",
        cleanliness: "unknown",
      }] : [],
      entries: [],
      agents: [],
    }
  }), [activeRepositoryKey, effectiveWorkingSetKeys, project?.repositories, roots])

  return (
    <div className={styles.editorSurface}>
      {shelfRepositories.length > 0 ? (
        <div className={`${styles.fileTree} ${styles.multiRepositoryFileTree}`}>
          <div className={styles.repositoryShelfFrame}>
            <RepositoryShelf
              repositories={shelfRepositories}
              onSelectRepository={(repositoryKey) => {
                selectRepository(repositoryKey)
              }}
              onToggleWorkingSet={toggleWorkingSet}
              onViewChange={(view) => {
                if (view !== "working-set" || !activeRepositoryKey || effectiveWorkingSetKeys.includes(activeRepositoryKey)) return
                const fallbackKey = effectiveWorkingSetKeys[0] ?? defaultRepository(project)?.key ?? null
                if (!fallbackKey) return
                setActiveRepositoryKey(fallbackKey)
                persistRepositoryState(effectiveWorkingSetKeys, fallbackKey)
              }}
              onOpenEntry={(repositoryKey, path) => {
                if (repositoryKey !== activeRepositoryKey) setActiveRepositoryKey(repositoryKey)
                const entry = rootsByRepository[repositoryKey]?.find((candidate) => candidate.path === path)
                if (!entry || !entry.directory) void openFile(path, space.editor.activePaneId, repositoryKey)
              }}
            />
          </div>
          <div className={styles.activeRepositoryTree}>
            <div className={styles.activeRepositoryTreeHeader}>
              <strong>{activeRepository?.label ?? projectName}</strong>
              <span>{roots?.length ?? 0} root entries</span>
            </div>
            {treeError ? <div className={styles.inlineRefusal} role="alert">{treeError}</div> : null}
            <ul aria-label={`${activeRepository?.label ?? projectName} file tree`}>
              {(roots ?? []).slice(0, visibleRootCount).map((entry) => (
                <TreeNode key={entry.path} entry={entry} depth={0} selectedPath={space.selectedPath} projectKey={projectKey} repositoryKey={activeRepository?.key ?? null} onOpen={(path) => void openFile(path)} selectedFileRef={space.selectedFileRef} projectIdentity={project?.identity ?? null} repositoryMountKey={activeRepository?.mount.key ?? null} />
              ))}
            </ul>
            {(roots?.length ?? 0) > visibleRootCount ? (
              <button
                type="button"
                className={styles.treeMore}
                aria-label={`Show ${Math.min(ROOT_ENTRY_BATCH_SIZE, (roots?.length ?? 0) - visibleRootCount)} more ${activeRepository?.label ?? projectName} entries`}
                onClick={() => setVisibleRootCount((current) => current + ROOT_ENTRY_BATCH_SIZE)}
              >
                Show more · {(roots?.length ?? 0) - visibleRootCount} remaining
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <nav className={styles.fileTree} aria-label="Workspace files">
          <div className={styles.fileTreeName}>{projectName.toUpperCase()}</div>
          {treeError ? <div className={styles.inlineRefusal} role="alert">{treeError}</div> : null}
          <ul>
            {(roots ?? []).map((entry) => (
              <TreeNode key={entry.path} entry={entry} depth={0} selectedPath={space.selectedPath} projectKey={projectKey} repositoryKey={null} onOpen={(path) => void openFile(path)} selectedFileRef={space.selectedFileRef} projectIdentity={project?.identity ?? null} repositoryMountKey={null} />
            ))}
          </ul>
        </nav>
      )}
      <div className={styles.editorWorkarea}>
        <div className={styles.editorActions}>
          <button type="button" onClick={split} disabled={space.editor.panes.length > 1} title="Split editor" aria-label="Split editor">
            <Columns2 size={14} />
          </button>
          <span className={styles.editorHint}>Ctrl+S save · Ctrl+Z undo · Ctrl+Y redo</span>
        </div>
        <div className={styles.panes} data-split={space.editor.panes.length > 1}>
          {space.editor.panes.map((pane) => {
            const paneKey = pane.activeFileRef ? canonicalWorkspaceObjectKey(pane.activeFileRef) : pane.activePath
            const buffer = paneKey ? buffers[paneKey] : null
            const staleRecovery = paneKey ? staleFileRecoveries[paneKey] : null
            return (
              <div
                key={pane.id}
                className={`${styles.pane} ${space.editor.activePaneId === pane.id ? styles.activePane : ""}`}
                onPointerDown={() => updatePanes(space.editor.panes, space.editor.openFiles, space.editor.openFileRefs, pane.activePath, pane.id, pane.activeFileRef ?? null)}
              >
                <div className={styles.tabs} role="tablist" aria-label={`${pane.id} editor tabs`}>
                  {openFiles.map((openedFile) => {
                    const dirty = buffers[openedFile.key] ? buffers[openedFile.key].content !== buffers[openedFile.key].savedContent : false
                    const repository = repositoryForKey(project, openedFile.repositoryKey)
                    return (
                      <div key={openedFile.key} className={`${styles.tabItem} ${paneKey === openedFile.key ? styles.activeTab : ""}`} role="presentation">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={paneKey === openedFile.key}
                          className={styles.tab}
                          onClick={() => {
                            const panes = space.editor.panes.map((item) => item.id === pane.id ? { ...item, activePath: openedFile.path, activeFileRef: openedFile.fileRef } : item)
                            setActiveRepositoryKey(openedFile.repositoryKey)
                            updatePanes(panes, space.editor.openFiles, space.editor.openFileRefs, openedFile.path, pane.id, openedFile.fileRef, openedFile.repositoryKey)
                            if (!buffers[openedFile.key]) {
                              void openFile(openedFile.path, pane.id, openedFile.repositoryKey)
                            }
                          }}
                        >
                          <span>{repository && project?.repositories && project.repositories.length > 1 ? `${repository.label} · ` : ""}{openedFile.path.split("/").at(-1)}</span>
                          {dirty ? <span className={styles.dirtyMark} aria-label="Unsaved">●</span> : null}
                        </button>
                        <button
                          type="button"
                          className={styles.closeTab}
                          aria-label={`Close ${repository ? `${repository.label} · ` : ""}${openedFile.path}`}
                          onClick={() => closeTab(openedFile.key)}
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
                        key={buffer.key}
                        path={buffer.path}
                        value={buffer.content}
                        selection={pane.selection}
                        onChange={(content) => {
                          bufferEpoch.current.set(buffer.key, (bufferEpoch.current.get(buffer.key) ?? 0) + 1)
                          if (content === buffer.savedContent) dirtyBuffers.current.delete(buffer.key)
                          else dirtyBuffers.current.add(buffer.key)
                          setBuffers((current) => ({ ...current, [buffer.key]: { ...current[buffer.key], content, error: null } }))
                        }}
                        onSelection={(selection) => {
                          const panes = space.editor.panes.map((item) => item.id === pane.id ? { ...item, selection } : item)
                          const controlsSelectedObject = space.editor.activePaneId === pane.id
                          updatePanes(
                            panes,
                            space.editor.openFiles,
                            space.editor.openFileRefs,
                            controlsSelectedObject ? buffer.path : space.selectedPath,
                            controlsSelectedObject ? pane.id : space.editor.activePaneId,
                            controlsSelectedObject ? buffer.fileRef : space.selectedFileRef,
                          )
                        }}
                        onSave={() => void save(buffer.key)}
                      />
                      <div className={styles.editorFooter}>
                        <span className={buffer.error ? styles.saveError : ""}>{buffer.error ?? buffer.path}</span>
                        <button
                          type="button"
                          onClick={() => void save(buffer.key)}
                          disabled={buffer.saving || buffer.content === buffer.savedContent}
                          aria-label={`Save ${buffer.path}`}
                        >
                          <Save size={12} /> {buffer.saving ? "Saving" : "Save"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className={styles.emptyEditor}>
                      {staleRecovery ? (
                        <div className={styles.staleFileRecovery} role="alert">
                          <strong>Saved file revision changed</strong>
                          <span>{staleRecovery.path} is still selected, but its saved revision is not the current verified checkout.</span>
                          <button type="button" onClick={() => reopenStaleFile(staleRecovery)}>
                            Reopen current revision
                          </button>
                        </div>
                      ) : <span>{roots === null ? "Mounting workspace…" : "Open a file"}</span>}
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
