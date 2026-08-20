import { describe, expect, it } from "vitest"

import {
  appendThreadMessage,
  buildThreadSystemPrompt,
  listThreadConversation,
  THREAD_MESSAGE_MAX_LENGTH,
  type ThreadConversationRepository,
  type ThreadMessage,
} from "@/lib/workbench/thread-conversation"

/**
 * CONVERSATION-FIRST (#762): a Thread's primary content is the conversation, and the rules around it
 * are small but load-bearing -- ownership on every call, the owner's words never lost, and a system
 * prompt that speaks the owner's language while staying honest about what the surface can do.
 */
function fakeRepository(overrides: Partial<{ threadUserId: string }> = {}) {
  const stored: ThreadMessage[] = []
  const touches: string[] = []
  const threadUserId = overrides.threadUserId ?? "owner-1"
  const repository: ThreadConversationRepository = {
    async getThread(userId, threadId) {
      if (threadId !== "thread-1") return null
      return { id: "thread-1", userId: threadUserId, projectId: 7, title: "Fix the auth screen" }
    },
    async getProject() {
      return { id: 7, name: "WilliamOS" }
    },
    async listMessages(_userId, _threadId, limit) {
      return stored.slice(-limit)
    },
    async insertMessage(_userId, message) {
      stored.push(message)
    },
    async touchThread(_userId, threadId) {
      touches.push(threadId)
    },
  }
  return { repository, stored, touches }
}

const at = () => new Date("2026-08-20T15:00:00.000Z")

describe("ownership is checked on every call", () => {
  it("refuses to read a thread the caller does not own", async () => {
    const { repository } = fakeRepository({ threadUserId: "someone-else" })
    await expect(listThreadConversation({ repository, userId: "owner-1", threadId: "thread-1" }))
      .rejects.toThrow("THREAD_NOT_OWNED")
  })

  it("refuses to write into a thread the caller does not own", async () => {
    const { repository, stored } = fakeRepository({ threadUserId: "someone-else" })
    await expect(
      appendThreadMessage({ repository, userId: "owner-1", threadId: "thread-1", role: "owner", content: "hello", now: at }),
    ).rejects.toThrow("THREAD_NOT_OWNED")
    expect(stored).toHaveLength(0)
  })

  it("refuses an unknown thread rather than inventing one", async () => {
    const { repository } = fakeRepository()
    await expect(listThreadConversation({ repository, userId: "owner-1", threadId: "missing" }))
      .rejects.toThrow("THREAD_NOT_OWNED")
  })
})

describe("appending a message", () => {
  it("persists the trimmed message and marks the thread active", async () => {
    const { repository, stored, touches } = fakeRepository()
    const message = await appendThreadMessage({
      repository,
      userId: "owner-1",
      threadId: "thread-1",
      role: "owner",
      content: "  why is this auth flow still here?  ",
      newId: () => "m-1",
      now: at,
    })
    expect(message).toMatchObject({ id: "m-1", role: "owner", content: "why is this auth flow still here?" })
    expect(stored).toHaveLength(1)
    // Talking in a thread is activity: it must sort as recent in the thread list.
    expect(touches).toEqual(["thread-1"])
  })

  it("refuses an empty message instead of storing a blank turn", async () => {
    const { repository } = fakeRepository()
    await expect(
      appendThreadMessage({ repository, userId: "owner-1", threadId: "thread-1", role: "owner", content: "   ", now: at }),
    ).rejects.toThrow("MESSAGE_EMPTY")
  })

  it("refuses a message beyond the cap rather than truncating silently", async () => {
    const { repository } = fakeRepository()
    await expect(
      appendThreadMessage({
        repository,
        userId: "owner-1",
        threadId: "thread-1",
        role: "owner",
        content: "x".repeat(THREAD_MESSAGE_MAX_LENGTH + 1),
        now: at,
      }),
    ).rejects.toThrow("MESSAGE_TOO_LONG")
  })

  it("accepts only the two conversation voices", async () => {
    const { repository } = fakeRepository()
    await expect(
      appendThreadMessage({
        repository,
        userId: "owner-1",
        threadId: "thread-1",
        role: "agent" as never,
        content: "hi",
        now: at,
      }),
    ).rejects.toThrow("MESSAGE_ROLE_INVALID")
  })
})

describe("the system prompt speaks the owner's language", () => {
  const prompt = buildThreadSystemPrompt({ projectName: "WilliamOS", threadTitle: "Fix the auth screen" })

  it("carries the thread and project so the conversation is situated", () => {
    expect(prompt).toContain("Fix the auth screen")
    expect(prompt).toContain("WilliamOS")
  })

  it("forbids requiring the owner to classify intent or speak system vocabulary", () => {
    expect(prompt).toContain("Never ask them to classify")
    expect(prompt).toContain("owner's language")
  })

  it("is honest that this surface cannot yet execute, so the model never invents progress", () => {
    expect(prompt).toContain("never claim to have run, edited, merged, or deployed")
  })
})
