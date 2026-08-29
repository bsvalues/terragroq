import { describe, expect, it } from "vitest"

import {
  CeremonialContextRetirementError,
  retireCeremonialContexts,
  type CeremonialContextAudit,
  type CeremonialContextGrant,
  type CeremonialContextRetirementDependencies,
  type CeremonialContextRetirementTransaction,
  type CeremonialContextWorkOrder,
} from "@/lib/environment/ceremonial-context-retirement"

const OWNER = "YCAbP6TPTU1sxkpf4gVl5FcX9Nf4lrwZ"
const OPERATION_ID = "WILLIAMOS_RETIRE_CEREMONIAL_CONTEXT_20260829"
const REASON = "WORKFLOW_INVERSION_CLEANUP"
const NOW = new Date("2026-08-29T23:30:00.000Z")

const activeGrants: CeremonialContextGrant[] = [
  {
    id: 13,
    userId: OWNER,
    ref: "GRANT-0003",
    workOrderId: 17,
    grantedBy: OWNER,
    grantedTo: "codex",
    authorityLevel: "A8_PUSH",
    status: "active",
    contentHash: "f1fe7b9609ad0e6d76bdc018a898339de6d8044722a811c8ba238c667080a59f",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  },
  {
    id: 14,
    userId: OWNER,
    ref: "GRANT-0004",
    workOrderId: 18,
    grantedBy: OWNER,
    grantedTo: "codex",
    authorityLevel: "A8_PUSH",
    status: "active",
    contentHash: "e57e424df2c23c52abcb08541ab7fc39437357f8b99bb614cc1d6c46b663c748",
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  },
]

const activeWorkOrders: CeremonialContextWorkOrder[] = [
  {
    id: 17,
    userId: OWNER,
    ref: "WO-0001",
    authorityGrantId: 13,
    status: "active",
    updatedAt: new Date("2026-08-29T22:59:04.953Z"),
    title: "Experience V2 server-derived work-context hardening",
    goal: "WILLIAMOS_EXPERIENCE_V2",
    scope: "WILLIAMOS_EXPERIENCE_V2 work-context hardening only",
    lane: "product-delivery",
    authorityLevel: "A8_PUSH",
    authorityGranted: "A8_PUSH",
    agent: "codex",
    closedAt: null,
  },
  {
    id: 18,
    userId: OWNER,
    ref: "WO-0002",
    authorityGrantId: 14,
    status: "active",
    updatedAt: new Date("2026-08-29T22:59:08.550Z"),
    title: "Experience V2 exact delivery for PRs 1069 through 1071",
    goal: "WILLIAMOS_EXPERIENCE_V2",
    scope: "PR #1069 -> #1070 -> #1071 exact existing changes only",
    lane: "product-delivery",
    authorityLevel: "A8_PUSH",
    authorityGranted: "A8_PUSH",
    agent: "codex",
    closedAt: null,
  },
]

function copyGrant(value: CeremonialContextGrant): CeremonialContextGrant {
  return { ...value, revokedAt: value.revokedAt ? new Date(value.revokedAt) : null }
}

function copyWorkOrder(value: CeremonialContextWorkOrder): CeremonialContextWorkOrder {
  return {
    ...value,
    updatedAt: new Date(value.updatedAt),
    closedAt: value.closedAt ? new Date(value.closedAt) : null,
  }
}

type State = {
  grants: CeremonialContextGrant[]
  workOrders: CeremonialContextWorkOrder[]
  governance: CeremonialContextAudit[]
  mirrors: CeremonialContextAudit[]
  effects: string[]
  failCas?: "grant" | "work-order"
}

function harness(seed: Partial<State> = {}): {
  state: State
  observedEffects: string[]
  dependencies: CeremonialContextRetirementDependencies
} {
  const observedEffects: string[] = []
  const state: State = {
    grants: (seed.grants ?? activeGrants).map(copyGrant),
    workOrders: (seed.workOrders ?? activeWorkOrders).map(copyWorkOrder),
    governance: [...(seed.governance ?? [])],
    mirrors: [...(seed.mirrors ?? [])],
    effects: seed.effects ?? [],
    failCas: seed.failCas,
  }
  const dependencies: CeremonialContextRetirementDependencies = {
    transaction: async (callback) => {
      const draft: State = {
        grants: state.grants.map(copyGrant),
        workOrders: state.workOrders.map(copyWorkOrder),
        governance: [...state.governance],
        mirrors: [...state.mirrors],
        effects: [...state.effects],
        failCas: state.failCas,
      }
      const transaction: CeremonialContextRetirementTransaction = {
        now: async () => new Date(NOW),
        lockGrants: async (ids) => {
          draft.effects.push(`lock-grants:${ids.join(",")}`)
          observedEffects.push(`lock-grants:${ids.join(",")}`)
          return draft.grants.filter((row) => ids.includes(row.id)).map(copyGrant)
        },
        lockWorkOrders: async (ids) => {
          draft.effects.push(`lock-work-orders:${ids.join(",")}`)
          observedEffects.push(`lock-work-orders:${ids.join(",")}`)
          return draft.workOrders.filter((row) => ids.includes(row.id)).map(copyWorkOrder)
        },
        readAudit: async (operationId) => {
          draft.effects.push(`read-audit:${operationId}`)
          observedEffects.push(`read-audit:${operationId}`)
          return { governance: [...draft.governance], mirrors: [...draft.mirrors] }
        },
        revokeGrant: async (expected, at) => {
          draft.effects.push(`revoke-grant:${expected.id}`)
          observedEffects.push(`revoke-grant:${expected.id}`)
          if (draft.failCas === "grant") return false
          const index = draft.grants.findIndex((row) => row.id === expected.id && row.status === "active")
          if (index < 0) return false
          draft.grants[index] = {
            ...draft.grants[index], status: "revoked", revokedAt: at,
            revokedBy: OWNER, revokeReason: REASON,
          }
          return true
        },
        abortWorkOrder: async (expected, at) => {
          draft.effects.push(`abort-work-order:${expected.id}`)
          observedEffects.push(`abort-work-order:${expected.id}`)
          if (draft.failCas === "work-order") return false
          const index = draft.workOrders.findIndex((row) => row.id === expected.id && row.status === "active")
          if (index < 0) return false
          draft.workOrders[index] = {
            ...draft.workOrders[index], status: "aborted", updatedAt: at, closedAt: at,
          }
          return true
        },
        appendGovernance: async (events) => {
          draft.effects.push(`append-governance:${events.length}`)
          observedEffects.push(`append-governance:${events.length}`)
          draft.governance.push(...events)
        },
        appendMirrors: async (events) => {
          draft.effects.push(`append-mirrors:${events.length}`)
          observedEffects.push(`append-mirrors:${events.length}`)
          draft.mirrors.push(...events)
        },
      }
      const result = await callback(transaction)
      Object.assign(state, draft)
      return result
    },
  }
  return { state, observedEffects, dependencies }
}

function expectNoMutationAttempt(effects: readonly string[]) {
  expect(effects.filter((effect) => /^(revoke|abort|append)-/.test(effect))).toEqual([])
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "CeremonialContextRetirementError", code })
}

describe("Experience V2 ceremonial authority retirement", () => {
  it("retires the two exact grants before aborting the two exact Work Orders and audits every mutation", async () => {
    const { state, observedEffects, dependencies } = harness()

    await expect(retireCeremonialContexts({ userId: OWNER }, dependencies)).resolves.toEqual({
      status: "RETIRED",
      operationId: OPERATION_ID,
      grantIds: [13, 14],
      workOrderIds: [17, 18],
    })

    expect(observedEffects).toEqual([
      "lock-grants:13,14",
      "lock-work-orders:17,18",
      `read-audit:${OPERATION_ID}`,
      "revoke-grant:13",
      "revoke-grant:14",
      "abort-work-order:17",
      "abort-work-order:18",
      "append-governance:4",
      "append-mirrors:4",
    ])
    expect(state.grants.map(({ status, revokedBy, revokeReason }) => ({ status, revokedBy, revokeReason }))).toEqual([
      { status: "revoked", revokedBy: OWNER, revokeReason: REASON },
      { status: "revoked", revokedBy: OWNER, revokeReason: REASON },
    ])
    expect(state.workOrders.map(({ status, closedAt }) => ({ status, closedAt: closedAt?.toISOString() }))).toEqual([
      { status: "aborted", closedAt: NOW.toISOString() },
      { status: "aborted", closedAt: NOW.toISOString() },
    ])
    expect(state.governance).toHaveLength(4)
    expect(state.mirrors).toHaveLength(4)
    for (const event of [...state.governance, ...state.mirrors]) {
      expect(event).toMatchObject({
        operationId: OPERATION_ID,
        reason: REASON,
        userId: OWNER,
        retiredAt: NOW.toISOString(),
      })
    }
  })

  it("fails closed before writes when any target is missing, foreign, or drifted", async () => {
    const missing = harness({ grants: [activeGrants[0]] })
    await expectCode(retireCeremonialContexts({ userId: OWNER }, missing.dependencies), "TARGET_MISSING")
    expectNoMutationAttempt(missing.observedEffects)

    const foreign = harness({ grants: [{ ...activeGrants[0], userId: "foreign" }, activeGrants[1]] })
    await expectCode(retireCeremonialContexts({ userId: OWNER }, foreign.dependencies), "TARGET_FOREIGN")
    expectNoMutationAttempt(foreign.observedEffects)

    const drifted = harness({ workOrders: [{ ...activeWorkOrders[0], scope: "broadened" }, activeWorkOrders[1]] })
    await expectCode(retireCeremonialContexts({ userId: OWNER }, drifted.dependencies), "TARGET_DRIFTED")
    expectNoMutationAttempt(drifted.observedEffects)
  })

  it("returns an audited no-op only for the exact fully retired state", async () => {
    const first = harness()
    await retireCeremonialContexts({ userId: OWNER }, first.dependencies)
    first.state.effects = []

    await expect(retireCeremonialContexts({ userId: OWNER }, first.dependencies)).resolves.toEqual({
      status: "ALREADY_RETIRED",
      operationId: OPERATION_ID,
      grantIds: [13, 14],
      workOrderIds: [17, 18],
    })
    expect(first.state.effects).toEqual([
      "lock-grants:13,14",
      "lock-work-orders:17,18",
      `read-audit:${OPERATION_ID}`,
    ])
  })

  it("rejects mixed terminal state and incomplete audit instead of repairing or duplicating it", async () => {
    const mixedGrant = {
      ...activeGrants[0], status: "revoked", revokedAt: NOW,
      revokedBy: OWNER, revokeReason: REASON,
    }
    const mixed = harness({ grants: [mixedGrant, activeGrants[1]] })
    await expectCode(retireCeremonialContexts({ userId: OWNER }, mixed.dependencies), "TARGET_MIXED")
    expectNoMutationAttempt(mixed.observedEffects)

    const retired = harness()
    await retireCeremonialContexts({ userId: OWNER }, retired.dependencies)
    retired.state.governance.pop()
    retired.state.effects = []
    retired.observedEffects.length = 0
    await expectCode(retireCeremonialContexts({ userId: OWNER }, retired.dependencies), "AUDIT_INCOMPLETE")
    expectNoMutationAttempt(retired.observedEffects)
  })

  it("rolls back all changes when any compare-and-swap loses its race", async () => {
    for (const failCas of ["grant", "work-order"] as const) {
      const candidate = harness({ failCas })
      await expectCode(retireCeremonialContexts({ userId: OWNER }, candidate.dependencies), "CONCURRENT_CHANGE")
      expect(candidate.state.grants).toEqual(activeGrants)
      expect(candidate.state.workOrders).toEqual(activeWorkOrders)
      expect(candidate.state.governance).toEqual([])
      expect(candidate.state.mirrors).toEqual([])
    }
  })

  it("rejects any caller other than the one exact audited owner before opening a transaction", async () => {
    const candidate = harness()
    await expectCode(retireCeremonialContexts({ userId: "other" }, candidate.dependencies), "OWNER_MISMATCH")
    expect(candidate.observedEffects).toEqual([])
  })

  it("uses a typed error class rather than leaking storage errors as authority decisions", () => {
    expect(new CeremonialContextRetirementError("TARGET_DRIFTED")).toMatchObject({
      name: "CeremonialContextRetirementError",
      code: "TARGET_DRIFTED",
    })
  })
})
