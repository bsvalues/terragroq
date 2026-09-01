"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Clipboard, Fingerprint, GitCommitHorizontal, LoaderCircle, ShieldCheck } from "lucide-react"

const ENDPOINT = "/api/governance/delivery-adoption"

type ArtifactPreview = Readonly<{
  status: "READY_FOR_CONFIRMATION"
  worldId: string
  pullRequest: number
  headSha: string
  paths: readonly string[]
  previewDigest: string
}>

type ArtifactAuthorization = Omit<ArtifactPreview, "status"> & Readonly<{
  status: "AUTHORIZED"
  idempotencyKey: string
  adoptionHash: string
  authorizationEventId: number
}>

type ArtifactSeal = Readonly<{
  status: "SEALED"
  worldId: string
  adoptionHash: string
  seal: Readonly<{ payload: Record<string, unknown>; signature: string }>
  sealBlock: string
}>

type RestoredArtifactSeal = ArtifactSeal & Omit<ArtifactPreview, "status">

type Failure = Readonly<{ error?: string; detail?: string }>
type Stage = "loading" | "ready" | "authorized" | "sealed" | "absent" | "error"

const ERROR_COPY: Readonly<Record<string, string>> = {
  DELIVERY_SEAL_CONFIRMATION_STALE: "The exact artifact changed after preview. WilliamOS did not authorize it.",
  DELIVERY_SEAL_ASSIGNMENT_STALE: "The Space authority changed or expired. WilliamOS did not continue.",
  DELIVERY_SEAL_DIFF_INVALID: "The current head or changed paths no longer match the exact artifact.",
  DELIVERY_SEAL_EVIDENCE_INVALID: "Exact-head validation and independent review are not complete and green.",
  DELIVERY_SEAL_SIGNING_UNAVAILABLE: "The WilliamOS delivery signing key is unavailable. No seal was issued.",
  NOT_OWNER: "Only the WilliamOS owner can authorize delivery adoption.",
  UNAUTHENTICATED: "Sign in before authorizing delivery adoption.",
  CROSS_ORIGIN_REFUSED: "WilliamOS refused this request because it did not come from the active application origin.",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
}

function isHead(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value)
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isPreview(value: unknown): value is ArtifactPreview {
  return isRecord(value)
    && hasExactKeys(value, ["status", "worldId", "pullRequest", "headSha", "paths", "previewDigest"])
    && value.status === "READY_FOR_CONFIRMATION"
    && typeof value.worldId === "string"
    && Number.isSafeInteger(value.pullRequest) && Number(value.pullRequest) > 0
    && isHead(value.headSha)
    && isStrings(value.paths)
    && isDigest(value.previewDigest)
}

function isAuthorization(value: unknown): value is ArtifactAuthorization {
  return isRecord(value)
    && hasExactKeys(value, ["status", "worldId", "pullRequest", "headSha", "paths", "previewDigest", "idempotencyKey", "adoptionHash", "authorizationEventId"])
    && value.status === "AUTHORIZED"
    && typeof value.worldId === "string"
    && Number.isSafeInteger(value.pullRequest) && Number(value.pullRequest) > 0
    && isHead(value.headSha) && isStrings(value.paths) && isDigest(value.previewDigest)
    && typeof value.idempotencyKey === "string" && value.idempotencyKey.length > 0
    && isDigest(value.adoptionHash)
    && Number.isSafeInteger(value.authorizationEventId) && Number(value.authorizationEventId) > 0
}

function hasSeal(value: Record<string, unknown>): value is Record<string, unknown> & { seal: ArtifactSeal["seal"] } {
  return isRecord(value.seal)
    && hasExactKeys(value.seal, ["payload", "signature"])
    && isRecord(value.seal.payload)
    && typeof value.seal.signature === "string" && value.seal.signature.length > 0
}

function deliverySealBlock(seal: ArtifactSeal["seal"]): string {
  return ["```WILLIAMOS_DELIVERY_SEAL", JSON.stringify(seal, null, 2), "```"].join("\n")
}

function isRestoredSeal(value: unknown): value is RestoredArtifactSeal {
  return isRecord(value)
    && hasExactKeys(value, ["status", "worldId", "pullRequest", "headSha", "paths", "previewDigest", "adoptionHash", "seal", "sealBlock"])
    && value.status === "SEALED"
    && typeof value.worldId === "string"
    && Number.isSafeInteger(value.pullRequest) && Number(value.pullRequest) > 0
    && isHead(value.headSha) && isStrings(value.paths) && isDigest(value.previewDigest)
    && isDigest(value.adoptionHash)
    && hasSeal(value)
    && value.sealBlock === deliverySealBlock(value.seal)
}

function compact(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

async function payload(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export function DeliveryAdoption({
  worldId,
  restoreOnly = false,
  onAvailabilityChange,
}: {
  worldId: string
  restoreOnly?: boolean
  onAvailabilityChange?: (available: boolean) => void
}) {
  const [stage, setStage] = useState<Stage>("loading")
  const [preview, setPreview] = useState<ArtifactPreview | null>(null)
  const [authorization, setAuthorization] = useState<ArtifactAuthorization | null>(null)
  const [seal, setSeal] = useState<ArtifactSeal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const attemptRef = useRef<string | null>(null)

  const explainFailure = useCallback((value: unknown, fallback: string) => {
    const failure = isRecord(value) ? value as Failure : null
    return ERROR_COPY[failure?.error ?? ""] ?? failure?.detail ?? fallback
  }, [])

  const loadPreview = useCallback(async (signal?: AbortSignal) => {
    setStage("loading")
    setError(null)
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "PREVIEW", worldId }),
        cache: "no-store",
        signal,
      })
      const value = await payload(response)
      const failureCode = isRecord(value) && typeof value.error === "string" ? value.error : null
      if (!response.ok && restoreOnly && failureCode === "DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND") {
        setPreview(null)
        setStage("absent")
        onAvailabilityChange?.(false)
        return
      }
      if (!response.ok || (!isPreview(value) && !isAuthorization(value) && !isRestoredSeal(value)) || value.worldId !== worldId) {
        throw new Error(explainFailure(value, "WilliamOS could not preview the exact artifact."))
      }
      setPreview({
        status: "READY_FOR_CONFIRMATION",
        worldId: value.worldId,
        pullRequest: value.pullRequest,
        headSha: value.headSha,
        paths: value.paths,
        previewDigest: value.previewDigest,
      })
      if (isAuthorization(value)) {
        attemptRef.current = value.idempotencyKey
        setAuthorization(value)
        setStage("authorized")
      } else if (isRestoredSeal(value)) {
        setSeal({ status: "SEALED", worldId: value.worldId, adoptionHash: value.adoptionHash, seal: value.seal, sealBlock: value.sealBlock })
        setStage("sealed")
      } else {
        setStage("ready")
      }
      onAvailabilityChange?.(true)
    } catch (cause) {
      if (signal?.aborted) return
      setStage("error")
      setError(cause instanceof Error ? cause.message : "WilliamOS could not preview the exact artifact.")
    }
  }, [explainFailure, onAvailabilityChange, restoreOnly, worldId])

  useEffect(() => {
    const controller = new AbortController()
    void loadPreview(controller.signal)
    return () => controller.abort()
  }, [loadPreview])

  async function authorize() {
    if (!preview || stage !== "ready") return
    const idempotencyKey = attemptRef.current ?? globalThis.crypto.randomUUID()
    attemptRef.current = idempotencyKey
    setStage("loading")
    setError(null)
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "AUTHORIZE", worldId, confirmedPreviewDigest: preview.previewDigest, idempotencyKey }),
        cache: "no-store",
      })
      const value = await payload(response)
      if (!response.ok || !isAuthorization(value) || value.worldId !== worldId) {
        throw new Error(explainFailure(value, "WilliamOS could not authorize this exact artifact."))
      }
      setAuthorization(value)
      setStage("authorized")
    } catch (cause) {
      setStage("ready")
      setError(cause instanceof Error ? cause.message : "WilliamOS could not authorize this exact artifact.")
    }
  }

  async function issue() {
    if (!preview || !authorization || stage !== "authorized") return
    const idempotencyKey = attemptRef.current ?? globalThis.crypto.randomUUID()
    attemptRef.current = idempotencyKey
    setStage("loading")
    setError(null)
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "ISSUE", worldId, idempotencyKey }),
        cache: "no-store",
      })
      const value = await payload(response)
      if (!response.ok || !isRestoredSeal(value) || value.worldId !== worldId || value.adoptionHash !== authorization.adoptionHash) {
        throw new Error(explainFailure(value, "WilliamOS could not validate and seal this exact artifact."))
      }
      setSeal({ status: "SEALED", worldId: value.worldId, adoptionHash: value.adoptionHash, seal: value.seal, sealBlock: value.sealBlock })
      setStage("sealed")
    } catch (cause) {
      setStage("authorized")
      setError(cause instanceof Error ? cause.message : "WilliamOS could not validate and seal this exact artifact.")
    }
  }

  async function copySealBlock() {
    if (!seal) return
    try {
      await navigator.clipboard.writeText(seal.sealBlock)
      setCopyStatus("Full delivery seal block copied.")
    } catch {
      setCopyStatus("Clipboard unavailable. Select and copy the full block below.")
    }
  }

  if (stage === "absent") return null

  return (
    <section aria-labelledby="delivery-adoption-title" className="overflow-hidden rounded border border-[#3b4939] bg-[#0b100c]">
      <div className="border-b border-[#2c352b] bg-[#121812] px-4 py-3">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9eac99]"><Fingerprint className="size-3.5" aria-hidden /> Exact artifact handoff</p>
        <h3 id="delivery-adoption-title" className="mt-1 text-sm font-semibold text-[#edf3e9]">Adopt an existing exact artifact</h3>
        <p className="mt-1 text-xs leading-5 text-[#9ca797]">This authorizes adoption and delivery of the exact server-measured artifact. It does not claim the historical edits were assigned before they occurred.</p>
      </div>

      <div className="grid gap-4 p-4">
        {preview ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-[18px_1fr] gap-x-3 text-xs">
              <div className="grid justify-items-center text-[#9caf94]"><GitCommitHorizontal className="size-4" aria-hidden /><span className="h-full w-px bg-[#42503f]" /></div>
              <div className="pb-3"><strong className="text-[#e4ece0]">PR #{preview.pullRequest} · exact head</strong><p className="mt-1 break-all font-mono text-[11px] text-[#8f9a8b]">{preview.headSha}</p></div>
              <div className="grid justify-items-center text-[#9caf94]"><ShieldCheck className="size-4" aria-hidden /></div>
              <div><strong className="text-[#e4ece0]">{preview.paths.length} exact changed {preview.paths.length === 1 ? "path" : "paths"}</strong><ul className="mt-1 grid gap-1 font-mono text-[11px] text-[#8f9a8b]">{preview.paths.map((path) => <li key={path} className="break-all">{path}</li>)}</ul></div>
            </div>
            <p className="border-l-2 border-[#54634f] pl-3 text-[11px] leading-5 text-[#82907e]">Preview {compact(preview.previewDigest)} · head and paths are derived by WilliamOS and cannot be edited here.</p>
          </div>
        ) : null}

        {stage === "loading" ? <p role="status" className="flex items-center gap-2 text-xs text-[#9ca797]"><LoaderCircle className="size-3.5 animate-spin" aria-hidden />Reading current Space authority and exact artifact…</p> : null}
        {stage === "sealed" && seal ? <div className="grid gap-3 rounded border border-[#52634d] bg-[#172016] px-3 py-3 text-xs text-[#dbe7d6]">
          <p role="status" className="flex items-center gap-2"><Check className="size-4" aria-hidden />Exact-head evidence is green and the delivery seal is issued · {compact(seal.adoptionHash)}</p>
          <p className="leading-5 text-[#aebaa9]">Publish this complete block in PR #{preview?.pullRequest}’s description so the protected delivery check can verify it.</p>
          <textarea aria-label="Complete WilliamOS delivery seal block" readOnly value={seal.sealBlock} rows={8} className="w-full resize-y rounded border border-[#42503f] bg-[#090c09] p-2 font-mono text-[10px] leading-4 text-[#dbe7d6]" />
          <button type="button" onClick={() => void copySealBlock()} className="flex items-center gap-2 justify-self-end rounded border border-[#8da083] bg-[#253122] px-3 py-2 font-semibold text-[#edf3e9]"><Clipboard className="size-3.5" aria-hidden />Copy complete seal block</button>
          {copyStatus ? <p role="status" className="text-[#aebaa9]">{copyStatus}</p> : null}
        </div> : null}
        {error ? <p role="alert" className="border-l-2 border-[#b86f66] pl-3 text-xs leading-5 text-[#efbbb4]">{error}</p> : null}

        {stage === "ready" ? <button type="button" onClick={() => void authorize()} className="justify-self-end rounded border border-[#8da083] bg-[#253122] px-4 py-2 text-xs font-semibold text-[#edf3e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7ba9d]">Authorize exact artifact</button> : null}
        {stage === "authorized" ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-[#9ca797]">Prospective authorization is persisted. WilliamOS will now inspect validation and independent review for this same head.</p><button type="button" onClick={() => void issue()} className="rounded border border-[#8da083] bg-[#253122] px-4 py-2 text-xs font-semibold text-[#edf3e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7ba9d]">Validate exact head and issue seal</button></div> : null}
        {stage === "error" ? <button type="button" onClick={() => void loadPreview()} className="justify-self-end rounded border border-[#52604f] px-3 py-2 text-xs text-[#d8e2d4]">Retry exact preview</button> : null}
      </div>
    </section>
  )
}
