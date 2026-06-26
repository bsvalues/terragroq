import { NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { buildRuntimeStatus } from "@/lib/ai/runtime"

// GET /api/copilot/runtime — model/runtime provenance for any shell client.
// Read-only, no authority. Fails closed: an unauthenticated caller gets 401.
// This is the canonical HTTP contract (10_API_CONTRACTS.md §2) consumed by the
// /runtime page, the future PWA, and the Tauri tray.
export async function GET() {
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return NextResponse.json(buildRuntimeStatus(), {
    headers: { "Cache-Control": "no-store" },
  })
}
