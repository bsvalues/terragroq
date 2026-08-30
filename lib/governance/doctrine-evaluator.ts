// Doctrine precedence is forbidden, then requires approval, then allowed.
export type DoctrineVerdict = Readonly<{
  verdict: "allowed" | "forbidden" | "requires_approval" | "unspecified"
  matches: readonly Readonly<{ ref: string | null; title: string; reason: string }>[]
}>

type DoctrineRule = Readonly<{
  ref: string | null
  title: string
  allowed: readonly string[]
  forbidden: readonly string[]
  requiresApproval: readonly string[]
}>

/** Canonical deterministic Doctrine evaluation shared by actions and transactions. */
export function evaluateDoctrine(action: string, rules: readonly DoctrineRule[]): DoctrineVerdict {
  const text = action.toLowerCase()
  const forbidden: DoctrineVerdict["matches"][number][] = []
  const approval: DoctrineVerdict["matches"][number][] = []
  const allowed: DoctrineVerdict["matches"][number][] = []
  for (const rule of rules) {
    for (const reason of rule.forbidden) {
      if (reason && text.includes(reason.toLowerCase())) forbidden.push({ ref: rule.ref, title: rule.title, reason })
    }
    for (const reason of rule.requiresApproval) {
      if (reason && text.includes(reason.toLowerCase())) approval.push({ ref: rule.ref, title: rule.title, reason })
    }
    for (const reason of rule.allowed) {
      if (reason && text.includes(reason.toLowerCase())) allowed.push({ ref: rule.ref, title: rule.title, reason })
    }
  }
  if (forbidden.length) return { verdict: "forbidden", matches: forbidden }
  if (approval.length) return { verdict: "requires_approval", matches: approval }
  if (allowed.length) return { verdict: "allowed", matches: allowed }
  return { verdict: "unspecified", matches: [] }
}
