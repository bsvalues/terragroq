import { embed, embedMany } from "ai"
import { EMBEDDING_MODEL } from "./config"

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text.replace(/\n/g, " ").slice(0, 8000),
  })
  return embedding
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: texts.map((t) => t.replace(/\n/g, " ").slice(0, 8000)),
  })
  return embeddings
}

// pgvector accepts a string literal of the form "[0.1,0.2,...]".
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`
}

// Naive but effective recursive-ish chunker by paragraphs with a size budget.
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim()
  if (!clean) return []

  const paragraphs = clean.split(/\n{2,}/)
  const chunks: string[] = []
  let current = ""

  for (const para of paragraphs) {
    const p = para.trim()
    if (!p) continue

    if ((current + "\n\n" + p).length > maxChars && current) {
      chunks.push(current.trim())
      // start next chunk with a tail overlap of the previous one
      current = current.slice(Math.max(0, current.length - overlap)) + "\n\n" + p
    } else {
      current = current ? current + "\n\n" + p : p
    }

    // hard-split very long single paragraphs
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars).trim())
      current = current.slice(maxChars - overlap)
    }
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks
}
