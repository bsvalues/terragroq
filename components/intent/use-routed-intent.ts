"use client"

import { useEffect, useState } from "react"
import { consumeIntentHandoff } from "@/components/intent/intent-handoff"

export function useRoutedIntent(destination: string) {
  const [intent, setIntent] = useState("")
  useEffect(() => setIntent(consumeIntentHandoff(destination)), [destination])
  return intent
}
