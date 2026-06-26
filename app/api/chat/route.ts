import { streamText, convertToModelMessages, type UIMessage } from "ai"
import { getUserId } from "@/lib/session"
import { CHAT_MODEL } from "@/lib/ai/config"
import { getActiveDoctrine } from "@/app/actions/doctrine"
import { getActiveDecisions } from "@/app/actions/decisions"
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
  const [doctrine, decisions, memories, corpus] = await Promise.all([
    getActiveDoctrine(userId),
    getActiveDecisions(userId),
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
      title: `Memory (${m.kind}) · ${m.authority}${m.stale ? " · stale" : ""}`,
      source: null as string | null,
      snippet: m.content,
      similarity: m.similarity,
      authority: m.authority,
      stale: m.stale,
    })),
  ]

  const doctrineBlock =
    doctrine.length > 0
      ? doctrine
          .map((d) => `- [${d.category}] ${d.title}: ${d.statement}`)
          .join("\n")
      : "(no doctrine ratified)"

  const decisionsBlock =
    decisions.length > 0
      ? decisions
          .map(
            (d) =>
              `- [${d.authority}] ${d.ref ?? `#${d.id}`} ${d.title}: ${d.decision}`,
          )
          .join("\n")
      : "(no active decisions)"

  const sourcesBlock =
    sources.length > 0
      ? sources
          .map((s) => {
            const authority =
              s.kind === "memory" && "authority" in s ? ` authority=${s.authority}` : ""
            const stale = s.kind === "memory" && "stale" in s && s.stale ? " STALE" : ""
            return `[${s.ref}] (${s.kind}${authority}${stale}) ${s.title}\n${s.snippet}`
          })
          .join("\n\n")
      : "(no relevant sources retrieved)"

  const system = `You are WilliamOS, a governed operator assistant — a provenance-forward second brain.

GOVERNING DOCTRINE (always obey these principles):
${doctrineBlock}

ACTIVE DECISIONS (binding decisions constrain what you may do or recommend; never act against them):
${decisionsBlock}

RETRIEVED CONTEXT (the ONLY facts you may treat as known about the operator):
${sourcesBlock}

RULES:
- Answer ONLY from the retrieved context and doctrine. Do not invent facts about the operator.
- Cite every claim drawn from context using bracketed numbers like [1] or [2], matching the source numbers above.
- Respect memory authority: 'canon' and 'reviewed' facts are trusted; 'unreviewed' facts are unverified intake — when you rely on one, note that it is unverified. Treat any source flagged STALE with caution and surface the caveat.
- Honor active decisions. If a request conflicts with a [binding] decision, refuse and cite the decision's reference (e.g. ADR-0001). Treat [advisory] decisions as strong defaults.
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
