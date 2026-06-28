export type CorpusSafetyPreview = {
  characterCount: number
  estimatedChunks: number
  secretSignals: string[]
  safeToReview: boolean
  guidance: string
}

export type CorpusSafetyPreviewInput = {
  title?: string
  source?: string
  content: string
}

const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "DATABASE_URL", pattern: /DATABASE_URL\s*=/i },
  { label: "BETTER_AUTH_SECRET", pattern: /BETTER_AUTH_SECRET\s*=/i },
  { label: "API key", pattern: /\b(sk-[A-Za-z0-9_-]{12,}|[A-Z0-9_]*API[_-]?KEY\s*=)/i },
  { label: "private key", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/i },
]

export function buildCorpusSafetyPreview(input: string | CorpusSafetyPreviewInput): CorpusSafetyPreview {
  const content = typeof input === "string" ? input : input.content
  const scanText = typeof input === "string" ? input : [input.title, input.source, input.content].join("\n")
  const trimmed = content.trim()
  const secretSignals = SECRET_PATTERNS.filter((entry) => entry.pattern.test(scanText)).map(
    (entry) => entry.label,
  )
  const estimatedChunks = trimmed.length === 0 ? 0 : Math.max(1, Math.ceil(trimmed.length / 1200))

  return {
    characterCount: content.length,
    estimatedChunks,
    secretSignals,
    safeToReview: trimmed.length > 0 && secretSignals.length === 0,
    guidance:
      secretSignals.length > 0
        ? "Potential secret-like content detected. Remove credentials before indexing."
        : trimmed.length > 0
          ? "Review title, source, and content before indexing. Ingestion stores embedded chunks."
          : "Paste document text to preview indexing impact before ingestion.",
  }
}
