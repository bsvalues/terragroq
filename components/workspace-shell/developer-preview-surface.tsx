"use client"

import { useEffect, useState } from "react"
import { AppWindow, Check, Layers3, MousePointer2 } from "lucide-react"

import type { VisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"
import styles from "./developer-preview-surface.module.css"
import { ApplicationControls } from "./hello-application-controls"
import type { ApplicationRuntimeState } from "./application-ui-contract"

export function developerPreviewWindowTitle(projectName: string): string {
  const name = projectName.trim() || "Project"
  return `Developer preview · ${name}`
}

export function DeveloperPreviewSurface({
  project,
  runningAppUrl,
  onInspectComposition,
}: Readonly<{
  project: VisibleWorkspaceProject
  runningAppUrl: string | null
  onInspectComposition?: () => void
}>) {
  const [interactionCount, setInteractionCount] = useState(0)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [applicationRuntimeState, setApplicationRuntimeState] = useState<ApplicationRuntimeState | "checking">("checking")
  const name = project.name.trim() || "Project"
  const terraFusionContract = project.kind === "core" && project.preview === "terrafusion"
  const application = project.kind === "application" ? project : null

  useEffect(() => {
    setInteractionCount(0)
    setPreviewRevision(0)
    setApplicationRuntimeState("checking")
  }, [project.key])

  const applicationRunning = applicationRuntimeState === "running"
  const previewUrl = application?.application.previewUrl ?? runningAppUrl

  return (
    <div className={`${styles.previewHost} ${application ? styles.applicationPreviewHost : ""}`}>
      {terraFusionContract && onInspectComposition ? (
        <button
          type="button"
          className={styles.compositionButton}
          onClick={onInspectComposition}
          aria-label="Inspect Preview composition"
          title="Inspect exact runtime composition"
        >
          <Layers3 size={13} aria-hidden />
          Composition
        </button>
      ) : null}

      {application ? (
        <>
          <ApplicationControls
            key={project.key}
            project={application}
            onRuntimeStateChange={setApplicationRuntimeState}
            onPreviewRefresh={() => setPreviewRevision((current) => current + 1)}
          />
          {applicationRunning && previewUrl ? (
            <iframe
              key={previewRevision}
              src={previewUrl}
              title={`Running ${name} application`}
              sandbox="allow-scripts"
              className={styles.runtimeFrame}
            />
          ) : (
            <div className={styles.applicationUnavailable} role="status">
              <AppWindow size={22} aria-hidden />
              <strong>{applicationRuntimeState === "checking" ? "Checking contained runtime" : "Contained runtime is not running"}</strong>
              <span>Start the contained runtime to open the real {name} preview.</span>
            </div>
          )}
        </>
      ) : runningAppUrl ? (
        <iframe
          key={previewRevision}
          src={runningAppUrl}
          title={`Running ${name} application`}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
          className={styles.runtimeFrame}
        />
      ) : terraFusionContract ? (
        <div className={styles.unavailable} role="status">
          <AppWindow size={26} aria-hidden />
          <strong>Developer preview unavailable</strong>
          <span>
            Attach the TerraFusion development runtime when you want the real target beside source.
            WilliamOS remains fully usable; no business workflow is being simulated.
          </span>
        </div>
      ) : (
        <section
          className={styles.fixture}
          aria-label={`${name} application-neutral developer fixture`}
        >
          <header className={styles.fixtureBar}>
            <span className={styles.fixtureIdentity}>
              <span className={styles.fixtureMark} aria-hidden>W</span>
              Application-neutral fixture
            </span>
            <span className={styles.fixtureState}>
              <span aria-hidden />
              interactive
            </span>
          </header>

          <div className={styles.fixtureApplication}>
            <div className={styles.fixtureAppBar}>
              <span>{name}</span>
              <span>developer surface</span>
            </div>
            <div className={styles.fixtureBody}>
              <div className={styles.fixtureCopy}>
                <span className={styles.eyebrow}>Project preview</span>
                <h2>{name} application fixture</h2>
                <p>
                  A neutral interaction surface for building {name} when the Project&apos;s own
                  runtime is not attached.
                </p>
                <button
                  type="button"
                  className={styles.interactionButton}
                  onClick={() => setInteractionCount((current) => current + 1)}
                >
                  <MousePointer2 size={14} aria-hidden />
                  Run interaction check
                </button>
                <output className={styles.interactionResult} role="status" aria-live="polite">
                  {interactionCount > 0 ? (
                    <>
                      <Check size={13} aria-hidden />
                      Interaction {interactionCount} received
                    </>
                  ) : "Ready for an interaction check"}
                </output>
              </div>

              <dl className={styles.fixtureFacts}>
                <div>
                  <dt>Target runtime</dt>
                  <dd>No target runtime attached</dd>
                </div>
                <div>
                  <dt>Fixture data</dt>
                  <dd>None</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>Interface development</dd>
                </div>
              </dl>
            </div>
          </div>

          <p className={styles.fixtureDisclosure}>
            Fixture interaction state is local to this Preview and is not target-application truth.
          </p>
        </section>
      )}
    </div>
  )
}
