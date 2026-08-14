export const INTENT_HANDOFF_KEY = "williamos:universal-intent:handoff"
const MAX_HANDOFF_AGE_MS = 5 * 60 * 1000

type IntentHandoff = {
  destination: string
  intent: string
  createdAt: number
}

export function storeIntentHandoff(destination: string, intent: string) {
  const handoff: IntentHandoff = {
    destination,
    intent: intent.trim().slice(0, 2000),
    createdAt: Date.now(),
  }
  sessionStorage.setItem(INTENT_HANDOFF_KEY, JSON.stringify(handoff))
}

export function consumeIntentHandoff(destination: string): string {
  const raw = sessionStorage.getItem(INTENT_HANDOFF_KEY)
  if (!raw) return ""
  try {
    const handoff = JSON.parse(raw) as Partial<IntentHandoff>
    if (
      handoff.destination !== destination ||
      typeof handoff.intent !== "string" ||
      typeof handoff.createdAt !== "number"
    ) {
      return ""
    }
    sessionStorage.removeItem(INTENT_HANDOFF_KEY)
    if (Date.now() - handoff.createdAt > MAX_HANDOFF_AGE_MS) return ""
    return handoff.intent.trim().slice(0, 2000)
  } catch {
    sessionStorage.removeItem(INTENT_HANDOFF_KEY)
    return ""
  }
}
