import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js"
import { getSignupPolicy } from "@/lib/auth-policy"

const handlers = toNextJsHandler(auth.handler)

export const GET = handlers.GET

export async function POST(req: Request) {
  const url = new URL(req.url)
  const isEmailSignup = /\/api\/auth\/sign-up\/email\/?$/.test(url.pathname)

  if (isEmailSignup) {
    const policy = await getSignupPolicy()
    if (!policy.open) {
      return Response.json(
        {
          code: "SIGNUP_DISABLED",
          message:
            policy.reason ??
            "Owner provisioning is disabled by policy. Contact the Primary Operator.",
        },
        { status: 403 },
      )
    }
  }

  return handlers.POST(req)
}
