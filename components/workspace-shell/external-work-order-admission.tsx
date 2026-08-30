"use client"

import { useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, GitPullRequest, ShieldCheck } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// The server digest binds the owner's explicit admission.
const CONFIRMATION = "ADMIT_EXTERNAL_WORK_ORDER" as const

type AdmissionStep = "capture" | "review" | "complete"
type ExternalSource = "github" | "other"

type AdmissionResult = Readonly<{
  status: "ADMITTED" | "ALREADY_ADMITTED"
  replayed: boolean
  worldId: string
  outcomeKey: string
  workOrder: Readonly<{ id: number; ref: string; externalRef: string }>
  authority: Readonly<{ level: "A2_WRITE_OWN"; grantRef: string }>
  reservedPaths: readonly string[]
  provenanceDigest: string
}>

type AdmissionError = Readonly<{ error?: string; detail?: string }>

type ExternalWorkOrderPacket = Readonly<{
  source: ExternalSource
  externalRef: string
  title: string
  objective: string
  repository: string
  authorityEvidence: readonly string[]
  reservedPaths: readonly string[]
  forbiddenPaths?: readonly string[]
  validators?: readonly string[]
  acceptanceCriteria?: readonly string[]
  pullRequest?: Readonly<{ number: number; headSha: string }>
}>

type AdmissionPreview = Readonly<{
  status: "READY_FOR_CONFIRMATION"
  worldId: string
  provenanceDigest: string
  externalWorkOrder: ExternalWorkOrderPacket
}>

const ERROR_COPY: Readonly<Record<string, string>> = {
  CONFIRMATION_REQUIRED: "The owner confirmation was not recorded. Review this packet and admit it again.",
  CONFIRMATION_STALE: "The packet changed after review. Preview the normalized packet again before admitting it.",
  REQUEST_FIELDS_INVALID: "The admission packet contains fields WilliamOS cannot accept.",
  DOCTRINE_FORBIDDEN: "WilliamOS doctrine forbids admitting this external Work Order.",
  WORK_ORDER_GOVERNANCE_REFUSED: "Work Order governance refused this admission packet.",
  EXTERNAL_PROVENANCE_INVALID: "The external reference or authority evidence is not valid for admission.",
  IDEMPOTENCY_CONFLICT: "This admission attempt is already bound to a different packet. Review the current values and try again.",
  SPACE_ALREADY_BOUND: "This Space is already bound to different active work.",
  ACTIVE_OUTCOME_CONFLICT: "Another active outcome already owns this repository context.",
  EXTERNAL_WORK_ORDER_ALREADY_ADMITTED: "This external Work Order is already admitted elsewhere.",
  PROJECT_REPOSITORY_MISMATCH: "This repository does not match the persisted project bound to the Space.",
  PERSISTED_BINDING_INVALID: "The existing Space binding is not valid for external admission.",
  WORLD_NOT_FOUND: "This persisted Space no longer exists. Reopen the Space before admitting work.",
  NOT_OWNER: "Only the WilliamOS owner can admit external work.",
  UNAUTHENTICATED: "Sign in before admitting external work.",
  CROSS_ORIGIN_REFUSED: "WilliamOS refused this request because it did not come from the active application origin.",
  EXTERNAL_WORK_ORDER_ADMISSION_UNAVAILABLE: "Admission is temporarily unavailable. The packet was not changed or authorized.",
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))]
}

function compactDigest(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

function packetFingerprint(value: unknown): string {
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isExternalWorkOrderPacket(value: unknown): value is ExternalWorkOrderPacket {
  if (!isRecord(value)) return false
  if (value.source !== "github" && value.source !== "other") return false
  if (typeof value.externalRef !== "string" || typeof value.title !== "string"
    || typeof value.objective !== "string" || typeof value.repository !== "string"
    || !isStringArray(value.authorityEvidence) || !isStringArray(value.reservedPaths)) return false
  if (value.forbiddenPaths !== undefined && !isStringArray(value.forbiddenPaths)) return false
  if (value.validators !== undefined && !isStringArray(value.validators)) return false
  if (value.acceptanceCriteria !== undefined && !isStringArray(value.acceptanceCriteria)) return false
  return value.pullRequest === undefined || (isRecord(value.pullRequest)
    && typeof value.pullRequest.number === "number" && typeof value.pullRequest.headSha === "string")
}

function isPreview(value: unknown): value is AdmissionPreview {
  return isRecord(value)
    && value.status === "READY_FOR_CONFIRMATION"
    && typeof value.worldId === "string"
    && typeof value.provenanceDigest === "string"
    && isExternalWorkOrderPacket(value.externalWorkOrder)
}

function isAdmissionResult(value: unknown): value is AdmissionResult {
  return isRecord(value)
    && (value.status === "ADMITTED" || value.status === "ALREADY_ADMITTED")
    && typeof value.replayed === "boolean"
    && typeof value.worldId === "string"
    && typeof value.outcomeKey === "string"
    && isRecord(value.workOrder)
    && typeof value.workOrder.id === "number"
    && typeof value.workOrder.ref === "string"
    && typeof value.workOrder.externalRef === "string"
    && isRecord(value.authority)
    && value.authority.level === "A2_WRITE_OWN"
    && typeof value.authority.grantRef === "string"
    && isStringArray(value.reservedPaths)
    && typeof value.provenanceDigest === "string"
}

export function ExternalWorkOrderAdmission({
  worldId,
  persisted,
  className,
  onAdmitted,
}: {
  worldId: string | null
  persisted: boolean
  className?: string
  onAdmitted?: (result: AdmissionResult) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<AdmissionStep>("capture")
  const [source, setSource] = useState<ExternalSource>("github")
  const [externalRef, setExternalRef] = useState("")
  const [title, setTitle] = useState("")
  const [objective, setObjective] = useState("")
  const [repository, setRepository] = useState("")
  const [authorityEvidence, setAuthorityEvidence] = useState("")
  const [reservedPaths, setReservedPaths] = useState("")
  const [forbiddenPaths, setForbiddenPaths] = useState("")
  const [validators, setValidators] = useState("")
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("")
  const [pullRequestNumber, setPullRequestNumber] = useState("")
  const [pullRequestHead, setPullRequestHead] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AdmissionPreview | null>(null)
  const [result, setResult] = useState<AdmissionResult | null>(null)
  const attemptRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null)

  const externalWorkOrder = useMemo(() => {
    const pullNumber = Number(pullRequestNumber)
    const pullRequest = pullRequestNumber.trim() || pullRequestHead.trim()
      ? { number: pullNumber, headSha: pullRequestHead.trim() }
      : undefined
    return {
      source,
      externalRef: externalRef.trim(),
      title: title.trim(),
      objective: objective.trim(),
      repository: repository.trim(),
      authorityEvidence: lines(authorityEvidence),
      reservedPaths: lines(reservedPaths),
      validators: lines(validators),
      acceptanceCriteria: lines(acceptanceCriteria),
      ...(lines(forbiddenPaths).length ? { forbiddenPaths: lines(forbiddenPaths) } : {}),
      ...(pullRequest ? { pullRequest } : {}),
    }
  }, [acceptanceCriteria, authorityEvidence, externalRef, forbiddenPaths, objective, pullRequestHead, pullRequestNumber, repository, reservedPaths, source, title, validators])

  const validationError = useMemo(() => {
    if (!externalWorkOrder.externalRef || !externalWorkOrder.title || !externalWorkOrder.objective
      || !externalWorkOrder.repository || externalWorkOrder.authorityEvidence.length === 0
      || externalWorkOrder.reservedPaths.length === 0 || externalWorkOrder.validators.length === 0
      || externalWorkOrder.acceptanceCriteria.length === 0) {
      return "Complete the source, title, objective, repository, authority evidence, reserved paths, validators, and acceptance criteria."
    }
    if (externalWorkOrder.pullRequest
      && (!Number.isSafeInteger(externalWorkOrder.pullRequest.number) || externalWorkOrder.pullRequest.number <= 0
        || !/^[0-9a-f]{40}$/.test(externalWorkOrder.pullRequest.headSha))) {
      return "A pull request binding needs a positive number and an exact lowercase 40-character head SHA."
    }
    return null
  }, [externalWorkOrder])

  function reset() {
    setStep("capture")
    setError(null)
    setPreview(null)
    setResult(null)
    setSubmitting(false)
  }

  function handleOpen(next: boolean) {
    if (!next && submitting) return
    setOpen(next)
    if (!next) reset()
  }

  async function review(event: FormEvent) {
    event.preventDefault()
    setError(validationError)
    if (!worldId || !persisted || validationError || submitting) return
    setSubmitting(true)
    try {
      const response = await fetch("/api/environment/space/external-work-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "PREVIEW", worldId, externalWorkOrder }),
        cache: "no-store",
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isPreview(payload) || payload.worldId !== worldId) {
        const failure = isRecord(payload) ? payload as AdmissionError : null
        const code = failure?.error ?? `PREVIEW_${response.status}`
        throw new Error(ERROR_COPY[code] ?? failure?.detail ?? "WilliamOS could not preview this Work Order.")
      }
      setPreview(payload)
      setStep("review")
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : "WilliamOS could not preview this Work Order.")
    } finally {
      setSubmitting(false)
    }
  }

  async function admit() {
    if (!worldId || !persisted || validationError || submitting || !preview) return
    const fingerprint = packetFingerprint({ worldId, externalWorkOrder, confirmedProvenanceDigest: preview.provenanceDigest })
    const prior = attemptRef.current
    const attempt = prior?.fingerprint === fingerprint
      ? prior
      : { fingerprint, idempotencyKey: globalThis.crypto.randomUUID() }
    attemptRef.current = attempt
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/environment/space/external-work-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "ADMIT",
          worldId,
          idempotencyKey: attempt.idempotencyKey,
          confirmation: CONFIRMATION,
          confirmedProvenanceDigest: preview.provenanceDigest,
          externalWorkOrder,
        }),
        cache: "no-store",
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !isAdmissionResult(payload) || payload.worldId !== worldId) {
        const failure = isRecord(payload) ? payload as AdmissionError : null
        const code = failure?.error ?? `ADMISSION_${response.status}`
        if (code === "CONFIRMATION_STALE") {
          setPreview(null)
          setStep("capture")
        }
        throw new Error(ERROR_COPY[code] ?? failure?.detail ?? "WilliamOS could not admit this Work Order.")
      }
      attemptRef.current = null
      setResult(payload)
      setStep("complete")
      await onAdmitted?.(payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WilliamOS could not admit this Work Order.")
    } finally {
      setSubmitting(false)
    }
  }

  const controlClass = "rounded border border-[#344033] bg-[#101510] px-2.5 py-2 text-[12px] text-[#e0e8dc] outline-none placeholder:text-[#667063] focus:border-[#8fa486] focus:ring-1 focus:ring-[#8fa486]"
  const labelClass = "grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#96a391]"

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button type="button" className={className} disabled={!worldId || !persisted} title={!persisted ? "External work can be admitted only into a persisted Space." : undefined}>
          Admit external work
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-[#344033] bg-[#0d120d] p-0 text-[#e0e8dc] shadow-2xl sm:max-w-2xl">
        <DialogHeader className="border-b border-[#2c352b] bg-[#121812] px-6 py-5 pr-12">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9eac99]">
            <GitPullRequest className="size-3.5" aria-hidden /> External work ingress
          </div>
          <DialogTitle className="text-xl font-semibold tracking-tight text-[#edf3e9]">
            {step === "capture" ? "Bring authorized work into this Space" : step === "review" ? "Review the exact admission packet" : "Work is bound to this Space"}
          </DialogTitle>
          <DialogDescription className="leading-5 text-[#9ca797]">
            {step === "capture"
              ? "Record where the work came from, the owner authority that already covers it, and the paths it may touch. Admission does not trust a GitHub URL by itself."
              : step === "review"
                ? "This is an owner authority action. WilliamOS will verify the evidence, derive the bounded Codex grant, and bind this exact packet—never a broader one."
                : "The external identity, internal Work Order, grant, and Space assignment now share one persisted provenance digest."}
          </DialogDescription>
        </DialogHeader>

        {step === "capture" ? (
          <form onSubmit={(event) => void review(event)} className="grid gap-5 p-6">
            <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label className={labelClass}>Source
                <select value={source} onChange={(event) => setSource(event.target.value as ExternalSource)} className={controlClass}>
                  <option value="github">GitHub</option>
                  <option value="other">Other governed source</option>
                </select>
              </label>
              <label className={labelClass}>External Work Order reference
                <input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} className={controlClass} placeholder="https://github.com/owner/repo/issues/1109" autoFocus />
              </label>
            </div>
            <label className={labelClass}>Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={controlClass} placeholder="Repair the external Work Order ingress" />
            </label>
            <label className={labelClass}>Objective
              <textarea value={objective} onChange={(event) => setObjective(event.target.value)} className={`${controlClass} min-h-24 resize-y normal-case tracking-normal`} placeholder="Describe the bounded outcome already authorized by the owner." />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Repository
                <input value={repository} onChange={(event) => setRepository(event.target.value)} className={controlClass} placeholder="owner/repository" />
              </label>
              <label className={labelClass}>Authority evidence <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">one reference per line</span>
                <textarea value={authorityEvidence} onChange={(event) => setAuthorityEvidence(event.target.value)} className={`${controlClass} min-h-20 resize-y font-mono normal-case tracking-normal`} placeholder="owner-decision:…" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>Reserved paths <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">one path per line</span>
                <textarea value={reservedPaths} onChange={(event) => setReservedPaths(event.target.value)} className={`${controlClass} min-h-20 resize-y font-mono normal-case tracking-normal`} placeholder="components/workspace-shell/" />
              </label>
              <label className={labelClass}>Forbidden paths <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">optional</span>
                <textarea value={forbiddenPaths} onChange={(event) => setForbiddenPaths(event.target.value)} className={`${controlClass} min-h-20 resize-y font-mono normal-case tracking-normal`} placeholder=".env\nsecrets/" />
              </label>
            </div>
            <details open className="rounded border border-[#293128] bg-[#101510] px-3 py-2 text-xs text-[#a7b1a2]">
              <summary className="cursor-pointer font-semibold text-[#d9e2d5]">Required validation and delivery binding</summary>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>Pull request number <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">optional</span>
                    <input inputMode="numeric" value={pullRequestNumber} onChange={(event) => setPullRequestNumber(event.target.value)} className={controlClass} placeholder="1111" />
                  </label>
                  <label className={labelClass}>Exact head SHA
                    <input value={pullRequestHead} onChange={(event) => setPullRequestHead(event.target.value)} className={`${controlClass} font-mono normal-case tracking-normal`} placeholder="40-character commit SHA" />
                  </label>
                </div>
                <label className={labelClass}>Validators <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">one command per line</span>
                  <textarea value={validators} onChange={(event) => setValidators(event.target.value)} className={`${controlClass} min-h-16 resize-y font-mono normal-case tracking-normal`} />
                </label>
                <label className={labelClass}>Acceptance criteria <span className="font-normal normal-case tracking-normal text-[#6f7a6c]">one criterion per line</span>
                  <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} className={`${controlClass} min-h-16 resize-y normal-case tracking-normal`} />
                </label>
              </div>
            </details>
            {error ? <p role="alert" className="border-l-2 border-[#b86f66] pl-3 text-xs leading-5 text-[#efbbb4]">{error}</p> : null}
            <div className="flex justify-end">
              <button type="submit" disabled={submitting} className="rounded border border-[#687b63] bg-[#1a2419] px-4 py-2 text-xs font-semibold text-[#e5eee1] hover:bg-[#223020] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9caf94] disabled:opacity-60">{submitting ? "Preparing exact preview…" : "Review packet"}</button>
            </div>
          </form>
        ) : step === "review" && preview ? (
          <section className="grid gap-5 p-6">
            <div className="grid grid-cols-[auto_1fr] items-stretch gap-x-3" aria-label="Admission provenance path">
              <div className="grid place-items-center text-[#9caf94]"><GitPullRequest className="size-4" aria-hidden /><span className="h-full w-px bg-[#42503f]" /></div>
              <div className="pb-4"><strong className="text-sm">{preview.externalWorkOrder.externalRef}</strong><p className="mt-1 text-xs text-[#8f9a8b]">{preview.externalWorkOrder.repository} · {preview.externalWorkOrder.title}</p></div>
              <div className="grid place-items-center text-[#9caf94]"><ShieldCheck className="size-4" aria-hidden /></div>
              <div><strong className="text-sm">This persisted Space</strong><p className="mt-1 text-xs leading-5 text-[#8f9a8b]">WilliamOS verifies the authority evidence, creates the bounded internal chain, and derives Codex A2 authority server-side.</p></div>
            </div>
            <dl className="grid gap-2 rounded border border-[#303a2f] bg-[#101510] p-4 text-xs">
              <div className="grid gap-1 sm:grid-cols-[130px_1fr]"><dt className="text-[#778273]">Objective</dt><dd>{preview.externalWorkOrder.objective}</dd></div>
              <div className="grid gap-1 sm:grid-cols-[130px_1fr]"><dt className="text-[#778273]">Authority evidence</dt><dd className="font-mono">{preview.externalWorkOrder.authorityEvidence.join(" · ")}</dd></div>
              <div className="grid gap-1 sm:grid-cols-[130px_1fr]"><dt className="text-[#778273]">Reserved paths</dt><dd className="font-mono">{preview.externalWorkOrder.reservedPaths.join(" · ")}</dd></div>
              {preview.externalWorkOrder.pullRequest ? <div className="grid gap-1 sm:grid-cols-[130px_1fr]"><dt className="text-[#778273]">Pull request</dt><dd className="font-mono">#{preview.externalWorkOrder.pullRequest.number} · {preview.externalWorkOrder.pullRequest.headSha}</dd></div> : null}
              <div className="grid gap-1 sm:grid-cols-[130px_1fr]"><dt className="text-[#778273]">Provenance digest</dt><dd className="break-all font-mono" data-testid="provenance-digest">{preview.provenanceDigest}</dd></div>
            </dl>
            <p className="text-xs leading-5 text-[#9ca797]">Confirming admits this exact packet. It does not treat GitHub existence as authority, widen the declared paths, or accept client-supplied grant fields.</p>
            {error ? <p role="alert" className="border-l-2 border-[#b86f66] pl-3 text-xs leading-5 text-[#efbbb4]">{error}</p> : null}
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" disabled={submitting} onClick={() => { setError(null); setPreview(null); setStep("capture") }} className="flex items-center gap-1.5 rounded px-3 py-2 text-xs text-[#aeb8aa] hover:bg-[#182017]"><ArrowLeft className="size-3.5" aria-hidden />Edit packet</button>
              <button type="button" disabled={submitting} onClick={() => void admit()} className="rounded border border-[#8da083] bg-[#253122] px-4 py-2 text-xs font-semibold text-[#edf3e9] hover:bg-[#2d3b29] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a7ba9d] disabled:opacity-60">{submitting ? "Admitting exact packet…" : "Admit to this Space"}</button>
            </div>
          </section>
        ) : result ? (
          <section className="grid gap-5 p-6">
            <div className="rounded border border-[#42513e] bg-[#151d14] p-4">
              <p className="text-sm font-semibold text-[#e7efe3]">{result.replayed ? "This exact packet was already admitted." : "The Work Order is admitted and active."}</p>
              <p className="mt-1 text-xs leading-5 text-[#9ca797]">Select a reserved file, then use Delegate. Codex will verify this Space-bound assignment before it starts.</p>
            </div>
            <dl className="grid gap-2 font-mono text-xs">
              <div className="flex justify-between gap-4"><dt className="text-[#778273]">Work Order</dt><dd>{result.workOrder.ref}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[#778273]">Outcome</dt><dd className="truncate">{result.outcomeKey}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[#778273]">Authority</dt><dd>{result.authority.level} · Codex</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-[#778273]">Provenance</dt><dd title={result.provenanceDigest}>{compactDigest(result.provenanceDigest)}</dd></div>
            </dl>
            {error ? <p role="alert" className="border-l-2 border-[#b86f66] pl-3 text-xs leading-5 text-[#efbbb4]">{error}</p> : null}
            <div className="flex justify-end"><button type="button" onClick={() => handleOpen(false)} className="rounded border border-[#687b63] bg-[#1a2419] px-4 py-2 text-xs font-semibold text-[#e5eee1]">Continue in Space</button></div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
