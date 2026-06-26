import { embed, embedMany } from "ai"
import { EMBEDDING_MODEL } from "./config"

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: EMBEDDING_MODEL,
    value: text.replace(/\n/g, " ").trim(),
  })
  return embedding
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: EMBEDDING_MODEL,
    values: texts.map((t) => t.replace(/\n/g, " ").trim()),
  })
  return embeddings
}

// pgvector accepts a string like "[0.1,0.2,...]" for a vector literal.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`
}

/**
 * Simple, deterministic chunker: splits text into overlapping windows by
 * paragraph/word boundaries. Good enough for notes, docs, and pasted text.
 */
export function chunkText(text: string, chunkSize = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim()
  if (clean.length <= chunkSize) return clean.length ? [clean] : []

  const words = clean.split(/\s+/)
  const chunks: string[] = []
  let current: string[] = []
  let length = 0

  for (const word of words) {
    current.push(word)
    length += word.length + 1
    if (length >= chunkSize) {
      chunks.push(current.join(" "))
      // keep an overlap tail for context continuity
      const tail: string[] = []
      let tailLen = 0
      for (let i = current.length - 1; i >= 0 && tailLen < overlap; i--) {
        tail.unshift(current[i])
        tailLen += current[i].length + 1
      }
      current = tail
      length = tailLen
    }
  }
  if (current.length) chunks.push(current.join(" "))
  return chunks
}
