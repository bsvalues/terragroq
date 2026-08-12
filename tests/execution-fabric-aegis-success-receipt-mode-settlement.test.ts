import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  inspectReceiptModeSettlement,
  inspectSettlementTrustPayload,
  RECEIPT_SHA256,
  TRANSACTION_ID,
} from "../scripts/execution-fabric/provision/aegis-success-receipt-mode-settlement.mjs"

const exact = () => ({
  transactionId: TRANSACTION_ID,
  receiptSha256: RECEIPT_SHA256,
  receiptMetadataExact: true,
  receiptContentExact: true,
  claimExact: true,
  authorityExact: true,
  journalChainExact: true,
  journalTerminalExact: true,
  installedGenerationExact: true,
})

describe("AEGIS committed success-receipt mode settlement", () => {
  it("accepts only the exact committed 0400 predecessor and exact 0444 replay", () => {
    expect(inspectReceiptModeSettlement({ ...exact(), receiptMode: 0o400 })).toEqual({
      status: "RECONCILE_EXACT_RECEIPT_MODE",
      mutationRequired: true,
      executionAuthorized: false,
      activationAuthorized: false,
    })
    expect(inspectReceiptModeSettlement({ ...exact(), receiptMode: 0o444 })).toEqual({
      status: "SUCCESS_RECEIPT_MODE_SETTLED",
      mutationRequired: false,
      executionAuthorized: false,
      activationAuthorized: false,
    })
  })

  it("fails closed for foreign evidence, contradictory fields, and every other mode", () => {
    for (const key of Object.keys(exact())) {
      const observation: any = exact()
      observation[key] = typeof observation[key] === "boolean" ? false : "f".repeat(64)
      expect(inspectReceiptModeSettlement({ ...observation, receiptMode: 0o400 })).toMatchObject({ status: "BLOCKED" })
    }
    for (const receiptMode of [0, 0o440, 0o600, 0o644]) {
      expect(inspectReceiptModeSettlement({ ...exact(), receiptMode })).toMatchObject({ status: "BLOCKED" })
    }
    expect(inspectReceiptModeSettlement({ ...exact(), receiptMode: 0o400, extra: true })).toMatchObject({ status: "BLOCKED" })
  })

  it("requires a fresh external trust payload naming the exact settlement bytes", () => {
    const settlementSha256 = "a".repeat(64)
    const payload = {
      schemaVersion: 1,
      operation: "AEGIS_SUCCESS_RECEIPT_MODE_SETTLEMENT_TRUST",
      transactionId: TRANSACTION_ID,
      applyAuthorityId: "5368f65d-41ae-4141-93f6-bdc5f34a8ee6",
      journalHeadSha256: "725afe6748dab29e955261b1d0c736a816f291f1aaf5e0c9d826b2b01f04fcd5",
      receiptSha256: RECEIPT_SHA256,
      settlementSha256,
      reviewedCommit: "98b458b998010f8ccfe9902fd307d75c0ec8c309",
      issuedAt: "2026-08-12T21:00:00.000Z",
      expiresAt: "2026-08-12T21:15:00.000Z",
    }
    expect(inspectSettlementTrustPayload(payload, settlementSha256, "2026-08-12T21:14:59.999Z")).toBe(true)
    expect(inspectSettlementTrustPayload(payload, "c".repeat(64), "2026-08-12T21:14:59.999Z")).toBe(false)
    expect(inspectSettlementTrustPayload({ ...payload, reviewedCommit: "b".repeat(40) }, settlementSha256, "2026-08-12T21:14:59.999Z")).toBe(false)
    expect(inspectSettlementTrustPayload(payload, settlementSha256, "2026-08-12T21:15:00.000Z")).toBe(false)
    expect(inspectSettlementTrustPayload({ ...payload, extra: true }, settlementSha256, "2026-08-12T21:14:59.999Z")).toBe(false)
  })

  it("keeps the production mutation descriptor-bound and externally authenticated", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "../scripts/execution-fabric/provision/aegis-success-receipt-mode-settlement.mjs"), "utf8")
    for (const required of [
      "AEGIS_SUCCESS_RECEIPT_MODE_SETTLEMENT_TRUST",
      "crypto.verify(null",
      "canonicalRootJson(TRUST_FILE, 0o444)",
      "fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW",
      "settlement trust expired before mutation",
      "fs.fchmodSync(opened.fd, 0o444)",
      "fs.fsyncSync(opened.fd)",
      "FCHMOD_EXACT_CANONICAL_RECEIPT_ONLY",
    ]) expect(source).toContain(required)
    expect(source).not.toContain("chmodSync(RECEIPT")
  })
})
