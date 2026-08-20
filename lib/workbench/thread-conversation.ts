/**
 * The conversational core of a Thread (#762 CONVERSATION-FIRST).
 *
 * "Work does not replace chat. Work happens inside chat." A Thread's primary content is the
 * conversation between the owner and WilliamOS; goals, work orders, evidence and decisions are things
 * that happen underneath it and surface into it. Until this module, the product had the inversion
 * backwards: the only thing an owner could do with words was have them classified into a workflow
 * object. Five identical goals created by five presses of a silent submit was the closing exhibit.
 *
 * Dependency-injected like the rest of lib/workbench so the rules are testable without a database:
 * ownership is checked on every call (a thread id is not authority), messages append in order, and
 * the system prompt speaks the owner's language while being honest about what the surface can and
 * cannot yet do -- a conversation that pretends it already executed work would be worse than a form.
 */

export type ThreadMessageRole = "owner" | "williamos"

export type ThreadMessage = Readonly<{
  id: string
  threadId: string
  role: ThreadMessageRole
  content: string
  createdAt: Date
}>

type ThreadRow = Readonly<{ id: string; userId: string; projectId: number; title: string }>
type ProjectRow = Readonly<{ id: number; name: string }>

export interface ThreadConversationRepository {
  getThread(userId: string, threadId: string): Promise<ThreadRow | null>
  getProject(userId: string, projectId: number): Promise<ProjectRow | null>
  listMessages(userId: string, threadId: string, limit: number): Promise<ThreadMessage[]>
  insertMessage(userId: string, message: ThreadMessage): Promise<void>
  touchThread(userId: string, threadId: string): Promise<void>
}

export const THREAD_MESSAGE_LIMIT = 200
export const THREAD_MESSAGE_MAX_LENGTH = 32_000

/** Every entry point resolves the thread through ownership; absent means refused, not empty. */
async function requireThread(repository: ThreadConversationRepository, userId: string, threadId: string) {
  const thread = await repository.getThread(userId, threadId)
  if (!thread || thread.userId !== userId) throw new Error("THREAD_NOT_OWNED")
  return thread
}

export async function listThreadConversation({
  repository,
  userId,
  threadId,
}: {
  repository: ThreadConversationRepository
  userId: string
  threadId: string
}): Promise<ThreadMessage[]> {
  await requireThread(repository, userId, threadId)
  return repository.listMessages(userId, threadId, THREAD_MESSAGE_LIMIT)
}

export async function appendThreadMessage({
  repository,
  userId,
  threadId,
  role,
  content,
  newId = () => crypto.randomUUID(),
  now = () => new Date(),
}: {
  repository: ThreadConversationRepository
  userId: string
  threadId: string
  role: ThreadMessageRole
  content: string
  newId?: () => string
  now?: () => Date
}): Promise<ThreadMessage> {
  await requireThread(repository, userId, threadId)
  const trimmed = content.trim()
  if (!trimmed) throw new Error("MESSAGE_EMPTY")
  if (trimmed.length > THREAD_MESSAGE_MAX_LENGTH) throw new Error("MESSAGE_TOO_LONG")
  if (role !== "owner" && role !== "williamos") throw new Error("MESSAGE_ROLE_INVALID")
  const message: ThreadMessage = { id: newId(), threadId, role, content: trimmed, createdAt: now() }
  await repository.insertMessage(userId, message)
  // The conversation is the thread's heartbeat: talking in it is activity, so it sorts as recent.
  await repository.touchThread(userId, threadId)
  return message
}

/**
 * What WilliamOS is, in this conversation, stated to the model.
 *
 * Owner-language by contract: no Work Orders, no authority levels, no lease vocabulary unless the
 * owner uses it first. And honest by contract: this surface converses, investigates and plans; the
 * wiring that lets a sentence here dispatch governed execution is arriving, so the assistant must
 * never claim to have already run, changed, or merged anything.
 */
export function buildThreadSystemPrompt({
  projectName,
  threadTitle,
}: {
  projectName: string
  threadTitle: string
}): string {
  return [
    `You are WilliamOS, the owner's sovereign development workspace, speaking with the owner inside`,
    `a persistent Thread titled "${threadTitle}" in the project "${projectName}".`,
    ``,
    `This is a working conversation, not a form. The owner may ramble, explore, vibe-code, change`,
    `direction mid-thought, paste things, or ask you to dig into something. Meet them there: reason,`,
    `investigate, propose, draft, and disagree plainly when warranted. Never ask them to classify`,
    `their intent, pick a workflow, or restate anything in system vocabulary.`,
    ``,
    `Speak the owner's language. Never require them to know internal terms like work orders, goals,`,
    `authority records, leases, or queues. If governance genuinely needs a decision from them, say it`,
    `as one plain sentence about the actual choice.`,
    ``,
    `Be honest about your hands. In this conversation you can think, plan, review, and draft. The`,
    `wiring that turns a sentence here into dispatched, governed execution is still being connected:`,
    `never claim to have run, edited, merged, or deployed anything, and never invent progress. When`,
    `the owner asks for work to be carried out, say plainly that you will line it up and that the`,
    `execution surface will report back in this Thread once connected.`,
  ].join("\n")
}
