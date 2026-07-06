export const DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"

export type AuthIdentityCandidate = {
  email: string
  name?: string | null
}

const NON_PRIMARY_LOCAL_EMAILS = new Map<string, string>([
  ["operator@command.io", "seed/demo/test record"],
  ["test+wo@example.com", "test/work-order record"],
  ["diag+1782790395@example.com", "diagnostic/generated record"],
])

export function normalizeIdentityEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isDeclaredPrimaryEmail(email: string) {
  return normalizeIdentityEmail(email) === DECLARED_PRIMARY_EMAIL
}

export function classifyLocalAuthIdentity(email: string) {
  const normalized = normalizeIdentityEmail(email)

  if (normalized === DECLARED_PRIMARY_EMAIL) {
    return "primary"
  }

  return NON_PRIMARY_LOCAL_EMAILS.get(normalized) ?? "non-primary"
}

export function getPrimaryIdentityCandidates(candidates: AuthIdentityCandidate[]) {
  return candidates.filter((candidate) => isDeclaredPrimaryEmail(candidate.email))
}

export function getQuarantinedLocalAuthIdentities(candidates: AuthIdentityCandidate[]) {
  return candidates
    .filter((candidate) => !isDeclaredPrimaryEmail(candidate.email))
    .map((candidate) => ({
      ...candidate,
      classification: classifyLocalAuthIdentity(candidate.email),
    }))
}
