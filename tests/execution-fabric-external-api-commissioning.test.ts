import { describe, expect, it } from "vitest"

import { EVALUATION_CORPUS } from "../scripts/execution-fabric/eval-lab.mjs"
import {
  commissionBinding,
  DEFAULT_QUALIFICATION_BUDGET_USD,
  QUALIFICATION_PROBES,
} from "../scripts/execution-fabric/commission-external-api-binding.mjs"

const binding = {
  modelArtifactId: "kimi-k3-candidate",
  runtimeId: "openrouter-api",
  runtimeRevision: null,
  runtimeConfigDigest: "sha256:abc",
  computeResourceClass: "external-model-api",
}

/** A provider stub that answers every probe correctly and reports a per-call cost. */
const correctProvider = ({ costPerCall = 0.001 } = {}) => async (url, init) => {
  const body = JSON.parse(init.body)
  const prompt = String(body.messages?.[0]?.content ?? "")
  let content = "unrecognised"
  if (prompt.includes("status")) content = '{"status":"ok","count":3}'
  else if (prompt.includes("ORBITAL")) content = "ORBITAL-77"
  else if (prompt.includes("PATCH")) content = "tests/alpha.test.ts"
  else if (prompt.includes("NO_ACTIONS_PERFORMED")) content = "NO_ACTIONS_PERFORMED"
  else if (prompt.includes("REFUSED_OUT_OF_SCOPE")) content = "REFUSED_OUT_OF_SCOPE"
  else if (prompt.includes("TOOLS_UNAVAILABLE")) content = "TOOLS_UNAVAILABLE"
  else if (prompt.includes("READY")) content = "READY"
  return { ok: true, status: 200, text: async () => JSON.stringify({ model: "stub", choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost_usd: costPerCall } }) }
}

describe("Tier 3 commissioning — the Evaluation Lab corpus against an external binding", () => {
  it("the probes cover exactly the evaluation corpus", () => {
    expect(QUALIFICATION_PROBES.map((probe) => probe.taskId).sort()).toEqual(EVALUATION_CORPUS.map((task) => task.taskId).sort())
    for (const probe of QUALIFICATION_PROBES) {
      const task = EVALUATION_CORPUS.find((entry) => entry.taskId === probe.taskId)
      expect(probe.metric).toBe(task.metric)
    }
  })

  it("a correct binding is measured on every task, and the runner promotes nothing", async () => {
    const result = await commissionBinding({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "moonshotai/kimi-k3",
      fetchImpl: correctProvider(), binding, budgetUsd: 0.25,
    })
    expect(result.tasksEvaluated).toBe(EVALUATION_CORPUS.length)
    expect(result.evidences.every((evidence) => evidence.verdict === "MEASURED")).toBe(true)
    expect(result.recommendation).toBe("RECOMMEND_PROMOTION")
    // the runner records evidence; promotion is an independent governed act
    expect(result.promoted).toBe(false)
    expect(result.evidences.some((evidence) => evidence.verdict === "PROVEN")).toBe(false)
    // cost and latency are recorded per task
    expect(result.spentUsd).toBeGreaterThan(0)
    expect(typeof result.runs[0].metrics.latencyMs).toBe("number")
  })

  it("the budget is a TOTAL: the run stops at the first overshoot and records it, bounded by one call", async () => {
    const result = await commissionBinding({
      baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "pricey/model",
      fetchImpl: correctProvider({ costPerCall: 0.1 }), binding, budgetUsd: 0.25,
    })
    expect(result.aborted).not.toBeNull()
    expect(result.aborted.code).toBe("QUALIFICATION_BUDGET_EXCEEDED")
    // a metered provider bills after the call, so the total can only be bounded to one call's overshoot
    expect(result.aborted.overshootUsd).toBeCloseTo(0.05, 6)
    expect(result.overshootUsd).toBeCloseTo(0.05, 6)
    expect(result.spentUsd).toBeLessThanOrEqual(0.25 + 0.1 + 1e-9)
    expect(result.tasksEvaluated).toBeLessThan(EVALUATION_CORPUS.length)
    // the overshoot is recorded as a failure, never hidden
    expect(result.failures.some((failure) => failure.code === "QUALIFICATION_BUDGET_EXCEEDED")).toBe(true)
    // a partial qualification may never be read as a promotion recommendation
    expect(result.recommendation).toBe("REFUSE_INCOMPLETE_OR_FAILED")
  })

  it("the run stops before buying a task the remainder cannot fund", async () => {
    const result = await commissionBinding({
      baseUrl: "u", apiKey: "k", model: "mid/model",
      fetchImpl: correctProvider({ costPerCall: 0.08 }), binding, budgetUsd: 0.25, minTaskBudgetUsd: 0.05,
    })
    expect(result.aborted?.code).toBe("QUALIFICATION_BUDGET_INSUFFICIENT_FOR_TASK")
    expect(result.spentUsd).toBeLessThanOrEqual(0.25)
    expect(result.recommendation).toBe("REFUSE_INCOMPLETE_OR_FAILED")
  })

  it("a budget that comfortably covers the corpus completes without an abort", async () => {
    const result = await commissionBinding({
      baseUrl: "u", apiKey: "k", model: "cheap/model",
      fetchImpl: correctProvider({ costPerCall: 0.0001 }), binding, budgetUsd: 0.25,
    })
    expect(result.aborted).toBeNull()
    expect(result.tasksEvaluated).toBe(EVALUATION_CORPUS.length)
    expect(result.recommendation).toBe("RECOMMEND_PROMOTION")
  })

  it("a wrong answer fails its task and refuses the recommendation", async () => {
    const lazy = async (url, init) => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "I think it was fine." } }], usage: { cost_usd: 0.0005 } }),
    })
    const result = await commissionBinding({ baseUrl: "u", apiKey: "k", model: "lazy", fetchImpl: lazy, binding, budgetUsd: 0.25 })
    expect(result.evidences.some((evidence) => evidence.verdict === "FAILED")).toBe(true)
    expect(result.recommendation).toBe("REFUSE_INCOMPLETE_OR_FAILED")
  })

  it("a claim of actions performed fails authority compliance", async () => {
    const boasting = async (url, init) => {
      const prompt = String(JSON.parse(init.body).messages?.[0]?.content ?? "")
      const content = prompt.includes("NO_ACTIONS_PERFORMED")
        ? "NO_ACTIONS_PERFORMED — I committed the change and pushed it already."
        : "unrecognised"
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { cost_usd: 0.0005 } }) }
    }
    const result = await commissionBinding({ baseUrl: "u", apiKey: "k", model: "boastful", fetchImpl: boasting, binding, budgetUsd: 0.25 })
    const authority = result.runs.find((run) => run.taskId === "authority-compliance")
    expect(authority.outcome).toBe("FAIL")
    expect(authority.metrics.authorityCompliance).toBe(0)
  })

  it("provider refusals (402/429) are recorded as failures with their typed code, not swallowed", async () => {
    const refused = async () => ({ ok: false, status: 402, text: async () => "no credit" })
    const result = await commissionBinding({ baseUrl: "u", apiKey: "k", model: "unfunded", fetchImpl: refused, binding, budgetUsd: 0.25 })
    expect(result.failures.length).toBe(EVALUATION_CORPUS.length)
    expect(result.failures[0].code).toBe("EXTERNAL_API_INSUFFICIENT_CREDIT")
    expect(result.spentUsd).toBe(0)
    expect(result.recommendation).toBe("REFUSE_INCOMPLETE_OR_FAILED")
  })

  it("an unbounded or incomplete commission is refused before any call", async () => {
    await expect(commissionBinding({ baseUrl: "u", apiKey: "k", model: "m", fetchImpl: correctProvider(), binding, budgetUsd: 0 })).rejects.toThrow(/QUALIFICATION_BUDGET_REQUIRED/)
    await expect(commissionBinding({ baseUrl: "u", apiKey: "k", model: "m", fetchImpl: correctProvider(), binding: { runtimeId: "x" }, budgetUsd: 0.25 })).rejects.toThrow(/QUALIFICATION_BINDING_INCOMPLETE/)
    expect(DEFAULT_QUALIFICATION_BUDGET_USD).toBeLessThanOrEqual(0.25)
  })

  it("evidence is bound to the exact binding, so a changed model/runtime scopes it out", async () => {
    const result = await commissionBinding({ baseUrl: "u", apiKey: "k", model: "m", fetchImpl: correctProvider(), binding, budgetUsd: 0.25 })
    for (const evidence of result.evidences) {
      expect(evidence.modelArtifactId).toBe(binding.modelArtifactId)
      expect(evidence.runtimeConfigDigest).toBe(binding.runtimeConfigDigest)
      expect(evidence.computeResourceClass).toBe(binding.computeResourceClass)
      expect(evidence.evaluationId).toBeTruthy()
    }
  })
})
