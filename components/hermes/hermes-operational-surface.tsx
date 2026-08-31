"use client"

import { useCallback, useEffect, useState } from "react"

import { HERMES_DOMAIN_NAMES, ownerHermesState, type HermesDomainName } from "@/lib/hermes/status-contract"
import type { HermesInferenceReceipt, HermesStatusProjection } from "@/lib/hermes/status-source"
import styles from "./hermes-operational-surface.module.css"

const DOMAIN_LABELS: Record<HermesDomainName, readonly [string, string]> = {
  appliance: ["Appliance", "Native monitor and current appliance truth"],
  inference: ["Local AI", "Canonical Ollama owner and Tesla P40"],
  protection: ["Recovery", "Backup, off-host copy, and restoration proof"],
  storage: ["Storage", "System, appliance data, and workbench budgets"],
  security: ["Security", "Observed containment and unresolved ingress truth"],
  doctrine: ["Doctrine", "Declared versus observed permanent state"],
  workbench: ["Workbench", "Disposable development capability"],
}

function ownerDomainState(state: HermesStatusProjection["domains"][HermesDomainName]["state"]) {
  return ownerHermesState(state)
}

function observedLabel(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Unparseable timestamp"
}

export function HermesOperationalSurface() {
  const [status, setStatus] = useState<HermesStatusProjection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [receipt, setReceipt] = useState<HermesInferenceReceipt | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/environment/hermes", { cache: "no-store" })
      const body = await response.json() as HermesStatusProjection & { error?: string }
      if (!response.ok) throw new Error(body.error ?? `HERMES_STATUS_${response.status}`)
      setStatus(body)
      setReceipt((current) => current
        && body.freshness.state === "FRESH"
        && current.sourceStatusSha256 === body.source.sha256
        ? current
        : null)
      setError(null)
      return body
    } catch {
      // A previously green packet is not current truth after a failed refresh. Discard it so the
      // summary, domains, and authority strip all fail closed together until a fresh read succeeds.
      setStatus(null)
      setReceipt(null)
      setError("Current HERMES evidence could not be read. No green claim is being made.")
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const verifyInference = useCallback(async () => {
    setVerifying(true)
    setReceipt(null)
    try {
      const response = await fetch("/api/environment/hermes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "verify-inference" }),
      })
      const body = await response.json() as { receipt?: HermesInferenceReceipt; error?: string }
      if (!body.receipt) throw new Error(body.error ?? `HERMES_INFERENCE_${response.status}`)
      const current = await refresh()
      if (!current || current.freshness.state !== "FRESH" || body.receipt.sourceStatusSha256 !== current.source.sha256) {
        throw new Error("HERMES_INFERENCE_EVIDENCE_CHANGED")
      }
      setReceipt(body.receipt)
    } catch {
      setError("The bounded local-AI verification could not produce a receipt. HERMES was not changed.")
    } finally {
      setVerifying(false)
    }
  }, [refresh])

  const visibleState = status?.freshness.state === "FRESH" ? status.ownerState : "UNKNOWN"
  const title = visibleState === "HEALTHY"
    ? "HERMES is healthy."
    : visibleState === "FAILED"
      ? "HERMES has a failed protection."
      : visibleState === "DEGRADED"
        ? "HERMES is operating with exceptions."
        : "HERMES current state is unknown."
  const authorityUnknown = !status || status.freshness.state !== "FRESH"
  const needsOwner = !authorityUnknown && status.ownerActions.length > 0

  return (
    <article className={styles.surface} aria-label="HERMES operational surface" data-testid="hermes-operational-surface">
      <header className={styles.hero}>
        <span className={styles.orb} data-state={visibleState} aria-hidden />
        <div>
          <span className={styles.eyebrow}>HERMES appliance · live evidence</span>
          <h2>{loading ? "Reading HERMES…" : title}</h2>
          <p>{status?.freshness.state === "FRESH"
            ? status.activeWork.headline
            : "Evidence is stale or unavailable. WilliamOS is suppressing green claims."}</p>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.button} type="button" onClick={() => void refresh()} disabled={loading}>Refresh evidence</button>
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" onClick={() => void verifyInference()} disabled={verifying || !status}>
            {verifying ? "Verifying local AI…" : "Verify local AI"}
          </button>
        </div>
      </header>

      <section
        className={styles.ownerStrip}
        data-authority={authorityUnknown ? "unknown" : needsOwner ? "required" : "clear"}
        aria-label="Owner authority state"
      >
        <span>Needs you</span>
        <strong>{authorityUnknown
          ? "Unknown"
          : needsOwner
            ? `${status.ownerActions.length} decision${status.ownerActions.length === 1 ? "" : "s"}`
            : "Nothing"}</strong>
      </section>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {status ? (
        <section className={styles.grid} aria-label="HERMES health domains">
          {HERMES_DOMAIN_NAMES.map((name) => {
            const domain = status.domains[name]
            const [label, description] = DOMAIN_LABELS[name]
            const state = status.freshness.state === "FRESH" ? ownerDomainState(domain.state) : "UNKNOWN"
            return (
              <details key={name} className={styles.domain} open={domain.state !== "HEALTHY"}>
                <summary>
                  <span><strong>{label}</strong><small>{domain.headline} · {description}</small></span>
                  <span className={styles.domainState} data-state={state}>{state}</span>
                </summary>
                <dl className={styles.facts}>
                  {domain.facts.length ? domain.facts.map((fact) => (
                    <div key={`${fact.label}:${fact.value}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
                  )) : <div><dt>Evidence</dt><dd>Unavailable</dd></div>}
                </dl>
              </details>
            )
          })}
        </section>
      ) : null}

      {status?.ownerActions.length ? (
        <section className={styles.alerts} aria-label="Owner decisions">
          <strong>Genuine authority requests</strong>
          <ul>{status.ownerActions.map((action) => <li key={action.id}><strong>{action.title}</strong> — {action.reason}</li>)}</ul>
        </section>
      ) : null}

      {status?.alerts.length ? (
        <section className={styles.alerts} aria-label="Native HERMES alerts">
          <strong>Native alerts</strong>
          <ul>{status.alerts.slice(-5).reverse().map((alert) => <li key={`${alert.observedAt}:${alert.message}`}>{alert.severity} · {alert.message}</li>)}</ul>
        </section>
      ) : null}

      {receipt ? (
        <section className={styles.receipt} data-result={receipt.result} aria-label="Local AI verification receipt">
          <strong>Local AI verification: {receipt.result}</strong>
          <dl>
            <div><dt>Model</dt><dd>{receipt.model}</dd></div>
            <div><dt>P40 evidence</dt><dd>{receipt.canonicalP40EvidenceFresh ? "Current" : "Not current"}</dd></div>
            <div><dt>Real response</dt><dd>{receipt.generatedExpectedToken ? "Verified" : "Failed"}</dd></div>
            <div><dt>GPU memory</dt><dd>{receipt.modelLoadedInGpuMemory ? "Model loaded" : "Unproven"}</dd></div>
            <div><dt>Receipt</dt><dd>{receipt.receiptId}</dd></div>
            <div><dt>Digest</dt><dd>{receipt.receiptSha256}</dd></div>
          </dl>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <span>{status ? `Observed ${observedLabel(status.observedAt)} · ${status.freshness.state.toLowerCase()}` : "No observation loaded"}</span>
        <span>{status?.source.sha256 ? `Evidence ${status.source.sha256.slice(0, 12)}…` : "Evidence digest unavailable"}</span>
      </footer>
    </article>
  )
}
