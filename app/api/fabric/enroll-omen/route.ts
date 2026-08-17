import fs from "node:fs/promises"
import path from "node:path"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = process.env.WILLIAMOS_PROJECT_ROOT ?? process.cwd()

/**
 * Serve the OMEN enrollment step so the node can enrol itself from one command.
 *
 * OMEN accepts nothing inbound, so the control node cannot reach in and enrol it -- the step has to
 * run there. Leaving the script on a git branch made that the operator's errand: find the branch,
 * check it out, locate the file. The cockpit is already reachable from OMEN, so it hands the step
 * over directly instead.
 *
 * Deliberately unauthenticated. OMEN has no session with this cockpit yet -- requiring one would be
 * a loop where enrolment needs the access that enrolment provides. Nothing here is a secret: the
 * file contains a PUBLIC key and a firewall rule, and running it requires administrator rights on
 * the machine doing the running. It grants this fabric's key access to that machine and nothing in
 * the other direction.
 */
export async function GET() {
  const file = path.join(PROJECT_ROOT, "scripts", "fabric", "enroll-omen.ps1")
  try {
    const script = await fs.readFile(file, "utf8")
    return new Response(script, {
      headers: {
        // text/plain so PowerShell's irm returns the script body rather than trying to parse it.
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    })
  } catch {
    return new Response("ENROLLMENT_SCRIPT_UNAVAILABLE\n", { status: 503, headers: { "content-type": "text/plain" } })
  }
}
