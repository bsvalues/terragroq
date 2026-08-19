import { createWorkOrder } from "@/app/actions/work-orders"
import { getSession } from "@/lib/session"
import { assertAdmissible, normaliseObjective, objectiveTitle } from "@/lib/objective/intake"
import { createObjectiveThread, resolveThreadProject } from "@/lib/objective/thread-binding"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Admit an operator objective as work (#874, #871 boundary 1).
 *
 * The objective becomes a draft work order carrying the operator's own text, attributable to whoever
 * submitted it, with a reference later steps can resolve. That is the whole of this seam: what it is
 * about, who asked, and something to refer to.
 *
 * No work-context receipt is required here, and that is deliberate rather than an oversight. A receipt
 * binds a lane to a work order it is already executing; requiring one to *request* work would mean an
 * objective could never be submitted without first naming the work order the objective is meant to
 * create. Admission grants nothing -- the draft carries no authority, and execution still needs a
 * recorded grant.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 })

  let body: { objective?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 })
  }

  const admissible = assertAdmissible(body.objective)
  if (!admissible.ok) {
    return Response.json({ error: admissible.failure, detail: admissible.detail }, { status: 400 })
  }

  const objective = normaliseObjective(body.objective as string)
  const title = objectiveTitle(objective)
  const created = await createWorkOrder({ title, description: objective, lane: "operator-objective" })

  // The thread is durable from the moment the objective is admitted, so everything the objective
  // produces has somewhere to attach. A thread that exists only as a query cannot be listed, linked
  // to, or carried forward.
  let thread: string | null = null
  let threadError: string | null = null
  try {
    const projectId = await resolveThreadProject(session.user.id, typeof (body as { project?: unknown }).project === "string" ? (body as { project: string }).project : undefined)
      // A work order without a ref cannot be a thread root, and inventing one would break the binding
      // that lets an objective find its own thread later.
      if (created.ref) {
      thread = await createObjectiveThread({ userId: session.user.id, projectId, workOrderRef: created.ref, title })
      }
  } catch (error) {
    // The objective is admitted either way -- losing the thread is a degraded answer, not a lost
    // request -- but the reason is reported. A silent null is how a binding that never worked went
    // unnoticed through an entire acceptance run.
    thread = null
    threadError = (error as Error)?.message ?? "thread creation failed"
  }

  return Response.json(
    {
      ok: true,
      status: "admitted",
      workOrder: created.ref,
      thread,
      ...(threadError ? { threadError } : {}),
      title,
      submittedBy: session.user.id,
      // Stated in the response so a caller cannot read admission as permission.
      authority: { granted: false, note: "admitted as a draft; execution requires a recorded authority grant" },
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  )
}
