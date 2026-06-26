// Tier-2 durable evidence ledger: filesystem export of governance artifacts as
// paired .md (human-readable) + .json (machine-readable) files under
// docs/devkit/<category>/. Each artifact carries a SHA-256 content hash for
// tamper-evidence. Writes are best-effort: on read-only/serverless filesystems
// the DB remains the canonical store and the export simply reports wrote=false.

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { hashRecord, sha256Hex } from "./hash"

export type ArtifactCategory =
  | "evidence"
  | "work-orders"
  | "decisions"
  | "doctrine"
  | "authority"
  | "loops"
  | "conflicts"

const ROOT = join(process.cwd(), "docs", "devkit")

export interface ArtifactResult {
  id: string
  category: ArtifactCategory
  markdownPath: string
  jsonPath: string
  sha256: string
  wrote: boolean
  error?: string
}

export interface BuildArtifactInput {
  id: string
  category: ArtifactCategory
  title: string
  // Ordered human-readable sections rendered into the .md file.
  sections: { heading: string; body: string }[]
  // The structured record persisted as .json (also what the hash is computed over).
  record: Record<string, unknown>
  sourceCommit?: string
}

function renderMarkdown(input: BuildArtifactInput, sha: string): string {
  const lines = [
    `# ${input.title}`,
    "",
    `- **artifact_id:** ${input.id}`,
    `- **artifact_type:** ${input.category}`,
    `- **sha256:** ${sha}`,
    `- **created_at:** ${new Date().toISOString()}`,
    input.sourceCommit ? `- **source_commit:** ${input.sourceCommit}` : null,
    "",
  ].filter(Boolean) as string[]
  for (const s of input.sections) {
    lines.push(`## ${s.heading}`, "", s.body, "")
  }
  return lines.join("\n")
}

// Build the artifact content + hash, and attempt to write both files.
export async function writeArtifact(input: BuildArtifactInput): Promise<ArtifactResult> {
  const sha = hashRecord(input.record)
  const jsonPayload = {
    artifact_id: input.id,
    artifact_type: input.category,
    sha256: sha,
    created_at: new Date().toISOString(),
    source_commit: input.sourceCommit ?? null,
    record: input.record,
  }
  const dir = join(ROOT, input.category)
  const markdownPath = join(dir, `${input.id}.md`)
  const jsonPath = join(dir, `${input.id}.json`)
  const relMd = `docs/devkit/${input.category}/${input.id}.md`
  const relJson = `docs/devkit/${input.category}/${input.id}.json`

  try {
    await mkdir(dir, { recursive: true })
    await writeFile(markdownPath, renderMarkdown(input, sha), "utf8")
    await writeFile(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8")
    return { id: input.id, category: input.category, markdownPath: relMd, jsonPath: relJson, sha256: sha, wrote: true }
  } catch (err) {
    console.log("[v0] writeArtifact (non-fatal, DB remains canonical):", (err as Error).message)
    return {
      id: input.id,
      category: input.category,
      markdownPath: relMd,
      jsonPath: relJson,
      sha256: sha,
      wrote: false,
      error: (err as Error).message,
    }
  }
}

// Hash an arbitrary string payload (e.g. raw file contents for an evidence packet).
export function hashContent(content: string): string {
  return sha256Hex(content)
}
