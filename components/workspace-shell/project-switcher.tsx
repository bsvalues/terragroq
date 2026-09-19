import type { WorkspaceProjectKey, VisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"

import styles from "./project-switcher.module.css"

export function ProjectSwitcher({
  activeProjectKey,
  projects,
}: Readonly<{
  activeProjectKey: WorkspaceProjectKey
  projects: readonly VisibleWorkspaceProject[]
}>) {
  return (
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
    </nav>
  )
}
