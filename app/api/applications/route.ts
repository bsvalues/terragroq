import { readBoundedJson } from "@/lib/environment/line-guard"
import { discoverApplications, publicApplication } from "@/lib/applications/application-catalog"
import { createApplication } from "@/lib/applications/application-creation"
import { applicationReply, authorizeApplicationOwner, guardApplicationMutation } from "@/lib/applications/application-route-context"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const owner = await authorizeApplicationOwner()
  if (!owner.ok) return owner.response
  try {
    const catalog = await discoverApplications()
    return applicationReply({ applications: catalog.applications.map(publicApplication), invalid: catalog.invalid })
  } catch { return applicationReply({ error: "APPLICATION_CATALOG_UNAVAILABLE" }, 503) }
}

export async function POST(request: Request) {
  const rejected = guardApplicationMutation(request)
  if (rejected) return rejected
  const owner = await authorizeApplicationOwner()
  if (!owner.ok) return owner.response
  const body = await readBoundedJson(request, 4096)
  if (!body.ok) return applicationReply({ error: body.error }, body.status)
  try { return applicationReply({ application: publicApplication(await createApplication(body.value)) }, 201) }
  catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "APPLICATION_REQUEST_INVALID") return applicationReply({ error: code }, 400)
    if (code === "APPLICATION_EXISTS") return applicationReply({ error: code }, 409)
    return applicationReply({ error: "APPLICATION_CREATION_UNAVAILABLE" }, 503)
  }
}
