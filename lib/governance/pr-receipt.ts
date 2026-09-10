import type { KeyObject } from "node:crypto"

import {
  verifyWilliamOSDeliverySeal,
  type WilliamOSDeliverySeal,
} from "./delivery-seal.ts"

export const RECEIPT_BLOCK = "WORK_CONTEXT_RECEIPT"
export const DELIVERY_SEAL_BLOCK = "WILLIAMOS_DELIVERY_SEAL"

export type PrReceiptFailure =
  | "FAILED_CONTEXT_NOT_PROVEN"
  | "FAILED_RECEIPT_MISMATCH"
  | "FAILED_STALE_MAIN"
  | "FAILED_SCOPE_ESCAPE"

export interface PrReceiptVerdict {
  ok: boolean
  failure?: PrReceiptFailure
  detail?: string
  recovery?: string
}

/** Retained only so old declarations can be identified and rejected with the correct typed reason. */
export function parseDeclaredReceipt(body: string | null | undefined): { token: string; facts: Record<string, unknown> } | null {
  if (!body) return null
  const match = new RegExp("```" + RECEIPT_BLOCK + "\\s*([\\s\\S]*?)```").exec(body)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1].trim()) as { token?: unknown; receipt?: unknown; facts?: unknown }
    const token = typeof parsed.token === "string" ? parsed.token : parsed.receipt
    return typeof token === "string" && token.trim() && parsed.facts && typeof parsed.facts === "object"
      ? { token: token.trim(), facts: parsed.facts as Record<string, unknown> }
      : null
  } catch {
    return null
  }
}

export function parseDeclaredDeliverySeals(body: string | null | undefined): WilliamOSDeliverySeal[] {
  if (!body) return []
  const fence = new RegExp("```" + DELIVERY_SEAL_BLOCK + "\\s*([\\s\\S]*?)```", "g")
  const seals: WilliamOSDeliverySeal[] = []
  for (const match of body.matchAll(fence)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as WilliamOSDeliverySeal
      if (parsed?.payload && typeof parsed.signature === "string") seals.push(parsed)
    } catch { /* malformed evidence is no evidence */ }
  }
  return seals
}

export interface ReviewInputs {
  body: string | null | undefined
  changedFiles: string[]
  headSha?: string
  repository?: string
  patchDigests?: Readonly<Record<string, string>>
  publicKeys?: Readonly<Record<string, KeyObject | string>>
  /** Deprecated reviewer inputs are ignored; PR prose cannot author authority or staleness facts. */
  mainMovedFiles?: string[]
  liveDoctrineDigest?: string
}

export function reviewPullRequestReceipt(input: ReviewInputs): PrReceiptVerdict {
  const seals = parseDeclaredDeliverySeals(input.body)
  if (seals.length === 0) {
    if (parseDeclaredReceipt(input.body)) {
      return {
        ok: false,
        failure: "FAILED_CONTEXT_NOT_PROVEN",
        detail: "legacy client-authored work-context receipts are retired; delivery requires a WilliamOS-issued delivery seal",
        recovery: "Deliver work from an existing Space-bound assignment and ask WilliamOS to seal that exact assignment output.",
      }
    }
    return {
      ok: false,
      failure: "FAILED_CONTEXT_NOT_PROVEN",
      detail: `the pull request declares no ${DELIVERY_SEAL_BLOCK} block`,
      recovery: "Deliver work from an existing Space-bound assignment; WilliamOS emits the seal when that assignment is ready for delivery.",
    }
  }
  if (!input.headSha || !input.patchDigests || !input.publicKeys || Object.keys(input.publicKeys).length === 0) {
    return {
      ok: false,
      failure: "FAILED_CONTEXT_NOT_PROVEN",
      detail: "WilliamOS delivery-seal verification material is unavailable",
      recovery: "Configure the repository's WilliamOS delivery public key and rerun the delivery check.",
    }
  }

  const covered = new Set<string>()
  for (const seal of seals) {
    if (!verifyWilliamOSDeliverySeal(seal, input.publicKeys)) {
      return {
        ok: false,
        failure: "FAILED_RECEIPT_MISMATCH",
        detail: "the delivery seal signature is invalid or its WilliamOS key is not configured",
        recovery: "Ask the active WilliamOS Space to seal the existing assignment delivery; do not edit or self-sign the seal.",
      }
    }
    if (seal.payload.delivery.commitSha !== input.headSha.toLowerCase()) {
      return {
        ok: false,
        failure: "FAILED_STALE_MAIN",
        detail: "the WilliamOS delivery seal is not bound to the exact pull-request head",
        recovery: "Ask WilliamOS to seal the current delivered assignment output.",
      }
    }
    if (input.repository && seal.payload.delivery.repository !== input.repository) {
      return {
        ok: false,
        failure: "FAILED_RECEIPT_MISMATCH",
        detail: "the WilliamOS delivery seal belongs to a different repository",
        recovery: "Use the seal emitted for this repository's existing Space assignment.",
      }
    }
    const paths = [...seal.payload.delivery.paths].map((item) => item.replace(/\\/g, "/")).sort()
    const pathKey = paths.join("\0")
    if (input.patchDigests[pathKey] !== seal.payload.delivery.patchDigest) {
      return {
        ok: false,
        failure: "FAILED_RECEIPT_MISMATCH",
        detail: "the delivered patch differs from the WilliamOS-sealed assignment output",
        recovery: "Deliver the sealed assignment output unchanged, or ask WilliamOS to seal the new exact output.",
      }
    }
    for (const changedPath of paths) covered.add(changedPath)
  }

  const escaped = input.changedFiles.map((item) => item.replace(/\\/g, "/")).filter((file) => !covered.has(file))
  if (escaped.length > 0) {
    return {
      ok: false,
      failure: "FAILED_SCOPE_ESCAPE",
      detail: `changed outside every WilliamOS-sealed assignment: ${escaped.slice(0, 10).join(", ")}`,
      recovery: "Remove the unassigned changes or deliver them from their own existing Space-bound assignments.",
    }
  }
  return { ok: true }
}
