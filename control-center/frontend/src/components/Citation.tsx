import React from 'react'

/**
 * Regex that matches vault note path references in assistant message text.
 *
 * Matches:
 *   - Optional leading `[`
 *   - A path containing `WilliamOS/` with at least one more segment
 *   - Ending in `.md`
 *   - Optional trailing `]`
 *
 * Examples:
 *   WilliamOS/03_Doctrine/Public-Trust.md
 *   [WilliamOS/Projects/X.md]
 */
const VAULT_PATH_RE = /\[?(WilliamOS\/[^\s\]]+\.md)\]?/g

interface CitationChipProps {
  fullPath: string
}

function CitationChip({ fullPath }: CitationChipProps) {
  const basename = fullPath.split('/').pop() ?? fullPath
  return (
    <span
      title={fullPath}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: 'rgba(59,130,246,0.12)',
        border: '1px solid rgba(59,130,246,0.35)',
        borderRadius: 4,
        padding: '1px 6px',
        fontFamily: 'monospace',
        fontSize: '0.82em',
        color: '#93c5fd',
        cursor: 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        marginLeft: 2,
        marginRight: 2,
      }}
    >
      📄 {basename}
    </span>
  )
}

/**
 * Renders assistant message text, detecting vault note path references and
 * replacing them with styled inline Citation chips. Text without any path
 * references renders exactly as before (a plain string).
 */
export function renderWithCitations(text: string): React.ReactNode {
  // Fast path: no vault path references present
  if (!text.includes('WilliamOS/')) {
    return text
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset stateful lastIndex since we reuse the module-level regex literal
  const re = new RegExp(VAULT_PATH_RE.source, VAULT_PATH_RE.flags)

  while ((match = re.exec(text)) !== null) {
    const matchStart = match.index
    const matchEnd = re.lastIndex

    // Text before this match
    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart))
    }

    // The captured vault path (group 1)
    const vaultPath = match[1]
    parts.push(<CitationChip key={`citation-${matchStart}`} fullPath={vaultPath} />)

    lastIndex = matchEnd
  }

  // Remaining text after the last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length === 0 ? text : <>{parts}</>
}
