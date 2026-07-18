import { describe, expect, it } from "vitest"

import {
  SustainedZeroTouchSoakLedgerError,
  loadSustainedZeroTouchSoakLedger,
  verifyOpenSustainedZeroTouchSoakLedger,
} from "../scripts/multi-agent-operator/sustained-zero-touch-soak-ledger.mjs"

describe("WO-MAO-059 sustained zero-touch soak ledger", () => {
  it("records one continuous soak with the useful Work Order gate locally validated", () => {
    const result = verifyOpenSustainedZeroTouchSoakLedger()

    expect(result).toMatchObject({
      ok: true,
      workOrderId: "WO-MAO-059",
      status: "IN_PROGRESS",
      usefulWorkOrderCount: 10,
      soakDurationCertified: false,
      tenConsecutiveWorkOrdersCertified: true,
      certificationState: "WORK_ORDER_GATE_LOCALLY_VALIDATED_DURATION_PENDING",
      selectedUsefulWorkOrderCount: 10,
      completedUsefulWorkOrderCount: 10,
    })
    expect(result.ledgerHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("accepts sequence-exact partial progress without certifying the ten-work-order gate", () => {
    const ledger = loadSustainedZeroTouchSoakLedger()
    const partial = {
      ...ledger,
      usefulWorkOrderCount: 3,
      tenConsecutiveWorkOrdersCertified: false,
      certificationState: "NOT_CERTIFIED",
      completedUsefulWorkOrders: ledger.completedUsefulWorkOrders.slice(0, 3),
    }

    expect(verifyOpenSustainedZeroTouchSoakLedger(partial)).toMatchObject({
      usefulWorkOrderCount: 3,
      completedUsefulWorkOrderCount: 3,
      tenConsecutiveWorkOrdersCertified: false,
      certificationState: "NOT_CERTIFIED",
    })
  })

  it("fails closed if owner touch, safety, queue, or certification claims change", () => {
    const ledger = loadSustainedZeroTouchSoakLedger()
    const cases = [
      { ...ledger, minimumElapsedHours: 1 },
      { ...ledger, selectedUsefulWorkOrderQueue: ledger.selectedUsefulWorkOrderQueue.slice(1) },
      { ...ledger, soakDurationCertified: true },
      { ...ledger, usefulWorkOrderCount: 9 },
      { ...ledger, tenConsecutiveWorkOrdersCertified: false },
      { ...ledger, completedUsefulWorkOrders: ledger.completedUsefulWorkOrders.slice(1) },
      {
        ...ledger,
        completedUsefulWorkOrders: ledger.completedUsefulWorkOrders.map((entry: any, index: number) => index === 0
          ? { ...entry, result: "PASS / NORMALIZED_BUT_NOT_AUDIT_EXACT" }
          : entry),
      },
      {
        ...ledger,
        completedUsefulWorkOrders: ledger.completedUsefulWorkOrders.map((entry: any, index: number) => index === 5
          ? { ...entry, evidencePath: "docs/governance/devex-hook-tooling-program.md" }
          : entry),
      },
      {
        ...ledger,
        completedUsefulWorkOrders: ledger.completedUsefulWorkOrders.map((entry: any, index: number) => index === 9
          ? { ...entry, completedAt: "not-a-date" }
          : entry),
      },
      { ...ledger, ownerCounters: { ...ledger.ownerCounters, OWNER_ROUTINE_CONTACT_COUNT: 1 } },
      { ...ledger, ownerCounters: {} },
      {
        ...ledger,
        ownerCounters: Object.fromEntries(Object.entries(ledger.ownerCounters).filter(([key]) => key !== "OWNER_CREDENTIAL_TOUCH_COUNT")),
      },
      { ...ledger, blockedScope: { ...ledger.blockedScope, runtimeActivationAllowed: true } },
      { ...ledger, blockedScope: { ...ledger.blockedScope, paidOverageAllowed: true } },
      { ...ledger, blockedScope: { ...ledger.blockedScope, rejectedRuntimeRetryAllowed: true } },
      { ...ledger, blockedScope: {} },
      {
        ...ledger,
        blockedScope: Object.fromEntries(Object.entries(ledger.blockedScope).filter(([key]) => key !== "productionMutationAllowed")),
      },
    ]

    for (const value of cases) {
      expect(() => verifyOpenSustainedZeroTouchSoakLedger(value)).toThrow(SustainedZeroTouchSoakLedgerError)
    }
  })
})
