"use client"

import { useRef, useState } from "react"
import { Plus } from "lucide-react"

import type { WorkspaceProjectKey, VisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"

import { CreateApplicationDialog } from "./create-application-dialog"
import styles from "./project-switcher.module.css"

export function ProjectSwitcher({
  activeProjectKey,
  projects,
  onCreated,
}: Readonly<{
  activeProjectKey: WorkspaceProjectKey
  projects: readonly VisibleWorkspaceProject[]
  onCreated?: (projectKey: string) => void
}>) {
  const [creating, setCreating] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const closeCreateDialog = () => {
    setCreating(false)
    createButtonRef.current?.focus()
  }
  const openCreatedProject = (projectKey: string) => {
    if (onCreated) {
      closeCreateDialog()
      onCreated(projectKey)
    } else {
      setCreating(false)
      window.location.assign(`/?project=${encodeURIComponent(projectKey)}`)
    }
  }
  return (
    <>
      <nav className={styles.switcher} aria-label="Project switcher">
        <span className={styles.label}>Project</span>
        <span className={styles.projects}>
          {projects.map((project) => (
            <a
              key={project.key}
              href={`/?project=${encodeURIComponent(project.key)}`}
              aria-current={project.key === activeProjectKey ? "page" : undefined}
              className={project.key === activeProjectKey ? styles.active : styles.project}
            >
              {project.name}
            </a>
          ))}
        </span>
        <button ref={createButtonRef} type="button" className={styles.create} onClick={() => setCreating(true)} aria-label="Create application">
          <Plus size={13} aria-hidden />
          <span>Create application</span>
        </button>
      </nav>
      <CreateApplicationDialog
        open={creating}
        onClose={closeCreateDialog}
        onCreated={openCreatedProject}
      />
    </>
  )
}
