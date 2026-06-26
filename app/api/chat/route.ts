import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { getUserId } from "@/lib/session"
import { CHAT_MODEL } from "@/lib/ai/config"
import { getActiveDoctrine } from "@/app/actions/doctrine"
import { searchMemory } from "@/app/actions/memory"
import { searchCorpus } from "@/app/actions/documents"

export const maxDuration = 30

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")
  if (!last?.parts) return ""
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
}

export async function POST(req: Request) {
  let userId: string
  try {
    userId = await getUserId()
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }

  const { messages }: { messages: UIMessage[] } = await req.json()
  const query = lastUserText(messages)

  // Retrieve governed context in parallel.
  const [doctrine, memories, corpus] = await Promise.all([
    getActiveDoctrine(userId),
    query ? searchMemory(userId, query, 5) : Promise.resolve([]),
    query ? searchCorpus(userId, query, 5) : Promise.resolve([]),
  ])

  // Build numbered citation sources from corpus + memory.
  const sources = [
    ...corpus.map((c, i) => ({
      ref: i + 1,
      kind: "document" as const,
      title: c.title,
      source: c.source,
      snippet: c.content.slice(0, 300),
      similarity: c.similarity,
    })),
    ...memories.map((m, i) => ({
      ref: corpus.length + i + 1,
      kind: "memory" as const,
      title: `Memory (${m.kind})`,
      source: null as string | null,
      snippet: m.content,
      similarity: m.similarity,
    })),
  ]

  const doctrineBlock =
    doctrine.length > 0
      ? doctrine
          .map((d) => `- [${d.category}] ${d.title}: ${d.statement}`)
          .join("\n")
      : "(no doctrine ratified)"

  const sourcesBlock =
    sources.length > 0
      ? sources
          .map((s) => `[${s.ref}] (${s.kind}) ${s.title}\n${s.snippet}`)
          .join("\n\n")
      : "(no relevant sources retrieved)"

  const system = `You are WilliamOS, a governed operator assistant — a provenance-forward second brain.

GOVERNING DOCTRINE (always obey these principles):
${doctrineBlock}

RETRIEVED CONTEXT (the ONLY facts you may treat as known about the operator):
${sourcesBlock}

RULES:
- Answer ONLY from the retrieved context and doctrine. Do not invent facts about the operator.
- Cite every claim drawn from context using bracketed numbers like [1] or [2], matching the source numbers above.
- If the context does not contain the answer, say so plainly and suggest committing a memory or ingesting a document. Never fabricate citations.
- Be concise, direct, and operator-grade. No filler.`

  const result = streamText({
    model: CHAT_MODEL,
    system,
    messages: await convertToModelMessages(messages),
  })

  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({ sources }),
  })
}
