import { NextResponse } from "next/server"
import { getDeploymentStatus } from "@/lib/deployment/profile"

export const dynamic = "force-dynamic"

export async function GET() {
  const deployment = getDeploymentStatus()
  return NextResponse.json(deployment, {
    status: deployment.valid ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
