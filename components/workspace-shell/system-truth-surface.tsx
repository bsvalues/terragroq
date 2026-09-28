"use client"

import { useCallback, useEffect, useState } from "react"

import styles from "./system-truth-surface.module.css"

type TruthState = "live" | "stale" | "persisted" | "inferred" | "unknown"

interface SystemSignal {
  system: "ATLAS" | "HERMES" | "AEGIS"
  signal: string
  truthState: TruthState
  observedAt: string | null
  source: string
  summary: string
}

interface SystemTruth {
  ready: boolean
  databaseReady: boolean
  dbLatencyMs: number | null
  dbDetail: string | null
  authReady: boolean
  signup: { label: string; tone: string; title: string | null }
  runtime: {
    chatModel: string
    embeddingModel: string
    embeddingDimensions: number
    gateway: string
    provider: string
    fallback: boolean
    fallbackPolicy: string | null
  }
  env: string
  baseUrlOk: boolean
  baseUrlDetail: string | null
  signals: SystemSignal[]
  issues: { code: string; severity: string; message: string }[]
  checkedAt: string
}

const STATE_TONE: Record<TruthState, string> = {
  live: styles.pass,
  stale: styles.warn,
  persisted: styles.muted,
  inferred: styles.muted,
  unknown: styles.fail,
}

export function SystemTruthSurface({ onDismiss }: { onDismiss: () => void }) {
  const [truth, setTruth] = useState<SystemTruth | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/system/truth", { cache: "no-store" })
      if (!response.ok) {
        setTruth(null)
        setError(response.status === 401 ? "Sign in to see System truth." : `System truth is unavailable (${response.status}).`)
        return
      }
      setTruth((await response.json()) as SystemTruth)
    } catch {
      setTruth(null)
      setError("System truth could not be reached.")
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section className={styles.surface} aria-label="System truth">
      <header className={styles.meta}>
        <span>System · read-only truth</span>
        <span className={styles.controls}>
          <button type="button" className={styles.button} onClick={() => void refresh()} disabled={busy}>
            {busy ? "Checking" : "Refresh"}
          </button>
          <button type="button" className={styles.button} onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      </header>
      <div className={styles.body}>
        {busy && !truth ? (
          <p className={styles.muted}>Checking the lab…</p>
        ) : error ? (
          <p className={styles.fail}>{error}</p>
        ) : truth ? (
          <>
            <div className={styles.row}>
              <strong className={truth.ready ? styles.pass : styles.fail}>
                {truth.ready ? "Ready" : "Needs attention"}
              </strong>
              <span className={styles.muted}>Platform readiness</span>
            </div>
            <div className={styles.chips}>
              <span className={truth.databaseReady ? styles.pass : styles.fail}>
                DB: {truth.databaseReady ? "ready" : "blocked"}
                {truth.dbLatencyMs != null ? ` · ${truth.dbLatencyMs}ms` : ""}
              </span>
              <span className={truth.authReady ? styles.pass : styles.warn}>
                Auth: {truth.authReady ? "ready" : "setup needed"}
              </span>
              <span title={truth.signup.title ?? undefined} className={truth.signup.tone === "ready" ? styles.pass : styles.warn}>
                {truth.signup.label}
              </span>
              <span className={truth.runtime.fallback ? styles.warn : styles.pass} title={truth.runtime.fallbackPolicy ?? undefined}>
                Runtime: {truth.runtime.fallback ? "fallback" : "explicit"}
              </span>
              <span className={truth.env === "local" ? styles.warn : styles.pass}>Env: {truth.env}</span>
            </div>
            <p className={styles.subhead}>Nodes</p>
            <ul className={styles.signals}>
              {truth.signals.map((signal) => (
                <li key={`${signal.system}:${signal.signal}`}>
                  <strong>{signal.system}</strong>
                  <span>{signal.summary}</span>
                  <span className={STATE_TONE[signal.truthState]}>{signal.truthState}</span>
                  <span className={styles.muted}>
                    {signal.signal} · {signal.source}
                    {signal.observedAt ? ` · observed ${new Date(signal.observedAt).toISOString()}` : " · no live observation"}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.subhead}>Runtime</p>
            <p className={styles.muted}>
              {truth.runtime.gateway} · {truth.runtime.provider} · chat {truth.runtime.chatModel} · embeddings{" "}
              {truth.runtime.embeddingModel} ({truth.runtime.embeddingDimensions}d)
            </p>
            {truth.issues.length > 0 ? (
              <ul className={styles.issues}>
                {truth.issues.map((issue) => (
                  <li key={issue.code} className={issue.severity === "error" ? styles.fail : styles.warn}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <footer className={styles.footer}>
              System never starts, stops, repairs, deploys, or grants authority. Checked{" "}
              {new Date(truth.checkedAt).toISOString()}. Configuration and persisted history never become live status.
            </footer>
          </>
        ) : null}
      </div>
    </section>
  )
}
