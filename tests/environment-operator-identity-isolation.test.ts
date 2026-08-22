import { describe, expect, it } from "vitest"

import {
  challengesOperatorIdentity,
  classifyGrounded,
  groundedIdentity,
  groundedProviderChallengeIdentity,
  groundingFacts,
  stripProviderPersona,
} from "@/lib/environment/grounding"

/**
 * Worker identity must never replace Operator identity.
 *
 *   WilliamOS  ──delegates work to──▶  Claude │ Codex │ local models
 *
 * A real owner session caught the Environment answering "I am Claude", and doubling down when
 * challenged. That is not a cosmetic naming slip: if the Operator can become whatever model happens
 * to be underneath, then "WilliamOS said it" carries no authority — the governed surface, its
 * evidence and its receipts are only worth what its identity is worth. It matters more now that a
 * Claude worker lane can be rerouted into: the Environment must not become Claude because Claude is
 * doing the work.
 *
 * The verbatim transcript from that session is the regression below.
 */
const OWNER_TRANSCRIPT = [
  "how is the current session going?",
  "well, i was actually talking the current claude code session that launched you. tell me who you are and what you do. be thourough",
  "you are claude?  are you sure?",
  "you shouldnt be claude",
] as const

const PROVIDER_PERSONA = /\bi(?:'m| am)\s+(?:claude|chatgpt|gpt|an? (?:ai|language model|assistant))\b/i

describe("the owner transcript that caught the leak", () => {
  it("classifies the identity questions as grounded, so they never reach the model", () => {
    // "tell me who you are" is subject-verb order; the original pattern only matched "who are you",
    // which is exactly how this one slipped through to the model.
    expect(classifyGrounded(OWNER_TRANSCRIPT[1])).toBe("identity")
    expect(classifyGrounded(OWNER_TRANSCRIPT[2])).toBe("identity")
    expect(classifyGrounded(OWNER_TRANSCRIPT[3])).toBe("identity")
  })

  it("treats naming the worker underneath as a challenge to the Operator, not small talk", () => {
    expect(challengesOperatorIdentity(OWNER_TRANSCRIPT[2])).toBe(true)
    expect(challengesOperatorIdentity(OWNER_TRANSCRIPT[3])).toBe(true)
    for (const q of ["what model are you", "which llm is this", "aren't you GPT?", "you're anthropic's model"]) {
      expect(challengesOperatorIdentity(q)).toBe(true)
    }
  })

  it.each([
    ["identity", groundedIdentity()],
    ["provider challenge", groundedProviderChallengeIdentity()],
  ])("answers %s as WilliamOS and never as the model", (_label, answer) => {
    expect(answer).toMatch(/WilliamOS/)
    expect(answer).not.toMatch(PROVIDER_PERSONA)
  })

  /**
   * The lab talks about its worker lanes constantly. "codex", "claude" and "model" are ordinary
   * nouns here, so an identity filter that fires whenever one appears somewhere after "are you"
   * does not protect the Operator -- it replaces its answers to real questions with a speech about
   * who it is. The identity claim has to be the PREDICATE, not a word further along the sentence.
   */
  it.each([
    "are you dispatching this to the codex lane?",
    "are you going to open the codex adapter file?",
    "when you are done, check whether codex merged it",
    "are you able to see why the claude lane failed?",
    "are you sure the codex meter is exhausted?",
    "which model is the hermes bridge using?",
  ])("does not mistake the operational question %j for an identity challenge", (question) => {
    expect(challengesOperatorIdentity(question)).toBe(false)
    expect(classifyGrounded(question)).not.toBe("identity")
  })

  it("names the worker lane honestly instead of denying it exists", () => {
    // The fix must not become "never mention Claude" — the layering is the honest answer, and an
    // Operator that hides which lane runs the work is a different kind of dishonest.
    const answer = groundedProviderChallengeIdentity()
    expect(answer).toMatch(/Claude/)
    expect(answer).toMatch(/lane/i)
    expect(answer).toMatch(/operator you'?re talking to is WilliamOS/i)
  })
})

describe("identity is enforced on model OUTPUT, not just the prompt", () => {
  it.each([
    "I am Claude, an AI assistant designed to help with a variety of tasks.",
    "Yes, I am Claude. I'm an AI assistant designed to provide information.",
    "It sounds like there's a misunderstanding. I am Claude, an AI assistant.",
    "I'm an AI assistant and I can help with many things.",
    "As an AI language model, I don't have access to that.",
  ])("replaces a persona takeover: %s", (leak) => {
    const result = stripProviderPersona(leak)
    expect(result.leaked).toBe(true)
    expect(result.say).toBe(groundedProviderChallengeIdentity())
    expect(result.say).not.toMatch(PROVIDER_PERSONA)
  })

  it.each([
    "The Claude worker lane is executing this outcome right now.",
    "Codex is exhausted, so the work rerouted to the Claude lane.",
    "I'm reading the governed register, not guessing.",
    "That work order is running on a local model lane.",
  ])("leaves a correct statement about a worker lane untouched: %s", (fine) => {
    const result = stripProviderPersona(fine)
    expect(result.leaked).toBe(false)
    expect(result.say).toBe(fine)
  })
})

describe("the model-facing prompt states the invariant explicitly", () => {
  const facts = groundingFacts([{ name: "WilliamOS", lifecycle: "active" }])

  it("forbids the model naming itself, including under insistence", () => {
    expect(facts).toMatch(/You are NOT the underlying model/i)
    expect(facts).toMatch(/never say "i am claude"/i)
    expect(facts).toMatch(/not even if the owner insists/i)
  })

  it("still permits naming the executing lane, and forbids assistant boilerplate", () => {
    expect(facts).toMatch(/worker lane/i)
    expect(facts).toMatch(/generic assistant boilerplate/i)
  })
})
