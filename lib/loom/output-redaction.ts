const PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/gi
const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/i

const CONNECTION_STRING_ASSIGNMENT = /\b((?:[A-Z0-9_]*CONNECTION_STRING[A-Z0-9_]*|connection[_ -]?string))\s*[:=][^\r\n]*/gi

const SENSITIVE_ASSIGNMENT = new RegExp(
  String.raw`\b((?:[A-Z0-9_]*(?:DATABASE_URL|CONNECTION_STRING|PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*|password|passwd|passphrase|secret|token|api[_ -]?key|private[_ -]?key|connection[_ -]?string|account[_ -]?key|shared[_ -]?access[_ -]?(?:key|signature)))\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)`,
  "gi",
)

const PROVIDER_SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g
const AUTHORIZATION = /\b(authorization)\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi
const AUTH_SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi
const CREDENTIAL_URL = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi

/** Remove credentials from process output without erasing ordinary diagnostics. */
export function redactToolOutputText(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK, "[REDACTED_PRIVATE_KEY]")
    .replace(AUTHORIZATION, "$1: [REDACTED]")
    .replace(AUTH_SCHEME, "$1 [REDACTED]")
    .replace(CONNECTION_STRING_ASSIGNMENT, "$1=[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]")
    .replace(CREDENTIAL_URL, "$1$2:[REDACTED]@")
    .replace(PROVIDER_SECRET, "[REDACTED]")
}

export type ToolOutputRedactor = Readonly<{
  push(chunk: string): string
  end(): string
}>

/**
 * Buffer incomplete process lines before releasing them. That prevents a credential split across
 * arbitrary stdout/stderr chunks from being partially exposed before its sensitive shape is known.
 */
export function createToolOutputRedactor(): ToolOutputRedactor {
  let pending = ""
  let insidePrivateKey = false

  const redactLine = (line: string, terminator: string): string => {
    if (insidePrivateKey) {
      const end = PRIVATE_KEY_END.exec(line)
      PRIVATE_KEY_END.lastIndex = 0
      if (!end) return ""
      insidePrivateKey = false
      const remainder = line.slice((end.index ?? 0) + end[0].length)
      return remainder ? `${redactToolOutputText(remainder)}${terminator}` : ""
    }

    const begin = PRIVATE_KEY_BEGIN.exec(line)
    PRIVATE_KEY_BEGIN.lastIndex = 0
    if (begin && !PRIVATE_KEY_END.test(line.slice((begin.index ?? 0) + begin[0].length))) {
      PRIVATE_KEY_END.lastIndex = 0
      insidePrivateKey = true
      const prefix = line.slice(0, begin.index ?? 0)
      return `${redactToolOutputText(prefix)}[REDACTED_PRIVATE_KEY]${terminator}`
    }
    PRIVATE_KEY_END.lastIndex = 0
    return `${redactToolOutputText(line)}${terminator}`
  }

  const drain = (final: boolean): string => {
    let output = ""
    for (;;) {
      const match = /\r\n|\r|\n/.exec(pending)
      if (!match) break
      if (!final && match[0] === "\r" && match.index === pending.length - 1) break
      const line = pending.slice(0, match.index)
      pending = pending.slice(match.index + match[0].length)
      output += redactLine(line, match[0])
    }
    if (final && pending) {
      output += redactLine(pending, "")
      pending = ""
    }
    return output
  }

  return {
    push(chunk) {
      pending += chunk
      return drain(false)
    },
    end() {
      return drain(true)
    },
  }
}
