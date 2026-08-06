import { ClipboardCheck, FileSearch, ShieldCheck } from "lucide-react"

import { durableRecordDomId } from "@/components/outcome-queue/supporting-record-links"
import { Badge } from "@/components/ui/badge"

export type DurableEvidenceRecordProjection = {
  id: number
  ref: string | null
  workOrderId: number
  result: string
  repo: string | null
  branch: string | null
  head: string | null
  validators: string[]
  nextValidMove: string | null
  artifactPath: string | null
  createdAt: Date
}

export type DurableAuditRecordProjection = {
  id: number
  type: string
  summary: string
  register: string | null
  refId: number | null
  createdAt: Date
}

export function DurableEvidenceRecordPanel({
  requestedReference,
  record,
}: {
  requestedReference: string | null
  record: DurableEvidenceRecordProjection | null
}) {
  if (!requestedReference) return null

  return (
    <section
      id={durableRecordDomId("evidence", requestedReference)}
      aria-labelledby="linked-evidence-record-title"
      className="scroll-mt-6 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-success" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exact durable Evidence record
            </p>
          </div>
          <h2 id="linked-evidence-record-title" className="mt-2 text-base font-semibold">
            {record ? record.ref ?? `Evidence #${record.id}` : "Evidence record unavailable"}
          </h2>
        </div>
        <Badge variant="outline">read-only</Badge>
      </div>

      {record ? (
        <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <RecordField label="Durable ID" value={`evidence:${record.id}`} mono />
          <RecordField label="Evidence ref" value={record.ref ?? "not recorded"} mono />
          <RecordField label="Work Order" value={`work-order:${record.workOrderId}`} mono />
          <RecordField label="Result" value={record.result} />
          <RecordField label="Repository" value={record.repo ?? "not recorded"} mono />
          <RecordField label="Branch" value={record.branch ?? "not recorded"} mono />
          <RecordField label="Head" value={record.head ?? "not recorded"} mono />
          <RecordField
            label="Validators"
            value={record.validators.length > 0 ? record.validators.join("; ") : "not recorded"}
          />
          <RecordField label="Next gate" value={record.nextValidMove ?? "not recorded"} />
          <RecordField label="Artifact" value={record.artifactPath ?? "not recorded"} mono />
          <RecordField label="Recorded" value={formatTimestamp(record.createdAt)} />
        </dl>
      ) : (
        <UnavailableRecordCopy kind="Evidence" requestedReference={requestedReference} />
      )}
    </section>
  )
}

export function DurableAuditRecordPanel({
  requestedReference,
  record,
}: {
  requestedReference: string | null
  record: DurableAuditRecordProjection | null
}) {
  if (!requestedReference) return null

  return (
    <section
      id={durableRecordDomId("audit", requestedReference)}
      aria-labelledby="linked-audit-record-title"
      className="scroll-mt-6 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-success" aria-hidden />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exact durable Audit record
            </p>
          </div>
          <h2 id="linked-audit-record-title" className="mt-2 text-base font-semibold">
            {record ? `audit:${record.id}` : "Audit record unavailable"}
          </h2>
        </div>
        <Badge variant="outline">read-only</Badge>
      </div>

      {record ? (
        <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <RecordField label="Durable ID" value={`audit:${record.id}`} mono />
          <RecordField label="Type" value={record.type} mono />
          <RecordField label="Register" value={record.register ?? "not recorded"} />
          <RecordField
            label="Linked record"
            value={record.refId === null ? "not recorded" : String(record.refId)}
            mono
          />
          <RecordField label="Summary" value={record.summary} />
          <RecordField label="Recorded" value={formatTimestamp(record.createdAt)} />
        </dl>
      ) : (
        <UnavailableRecordCopy kind="Audit" requestedReference={requestedReference} />
      )}
    </section>
  )
}

function UnavailableRecordCopy({
  kind,
  requestedReference,
}: {
  kind: "Evidence" | "Audit"
  requestedReference: string
}) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-mono text-xs text-foreground">Requested: {requestedReference}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The requested {kind} identifier did not resolve to exactly one record owned by the current
          user. No broader or substitute record was displayed.
        </p>
      </div>
    </div>
  )
}

function RecordField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-all text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(value)
}
