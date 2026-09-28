"use client"

import { useId } from "react"

import type { AgentSessionReservationClaims } from "./agent-sessions"
import styles from "./context-loaded-panel.module.css"

export type ExecutionReservationsPanelProps = Readonly<{
  claims: AgentSessionReservationClaims
  initiallyOpen?: boolean
}>

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

export function ExecutionReservationsPanel({ claims, initiallyOpen = false }: ExecutionReservationsPanelProps) {
  const headingId = useId()
  const contractsId = `${headingId}-contracts`
  const environmentsId = `${headingId}-environments`

  return (
    <details
      className={styles.panel}
      open={initiallyOpen || undefined}
      aria-label="Execution reservations"
    >
      <summary className={styles.summary}>
        <span className={styles.summaryCopy}>
          <strong>Execution reservations</strong>
          <small>{countLabel(claims.contracts.length, "contract")} · {countLabel(claims.environments.length, "environment")}</small>
        </span>
        <span className={styles.evidenceLabel}>Evidence only</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>

      <div className={styles.body}>
        <p className={styles.authorityBoundary}>Recorded collision-control evidence · does not grant authority.</p>

        <section className={styles.section} aria-labelledby={contractsId}>
          <header className={styles.sectionHeader}>
            <h3 id={contractsId}>Contract claims</h3>
            <span>{countLabel(claims.contracts.length, "claim")}</span>
          </header>
          {claims.contracts.length > 0 ? (
            <ul className={styles.referenceList} aria-label="Contract reservation claims">
              {claims.contracts.map((claim) => (
                <li key={`${claim.contractIdentity}:${claim.revisionIdentity}:${claim.role}`}>
                  <span className={styles.lineHeading}>
                    <code>{claim.contractIdentity}</code>
                    <span className={styles.readOnly}>{claim.role}</span>
                  </span>
                  <span className={styles.lineMeta}>
                    <span>Exact revision</span>
                    <code>{claim.revisionIdentity}</code>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptyTruth}>No contract reservations were recorded.</p>}
        </section>

        <section className={styles.section} aria-labelledby={environmentsId}>
          <header className={styles.sectionHeader}>
            <h3 id={environmentsId}>Environment claims</h3>
            <span>{countLabel(claims.environments.length, "claim")}</span>
          </header>
          {claims.environments.length > 0 ? (
            <ul className={styles.referenceList} aria-label="Environment reservation claims">
              {claims.environments.map((claim) => (
                <li key={`${claim.environmentIdentity}:${claim.access}`}>
                  <span className={styles.lineHeading}>
                    <code>{claim.environmentIdentity}</code>
                    <span className={styles.readOnly}>{claim.access}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptyTruth}>No environment reservations were recorded.</p>}
        </section>
      </div>
    </details>
  )
}
