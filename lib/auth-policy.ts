import { pool } from "@/lib/db"

export type SignupMode = "open" | "bootstrap" | "closed"

export type SignupPolicy = {
  mode: SignupMode
  open: boolean
  reason?: string
}

function normalizeSignupMode(value: string | undefined): SignupMode {
  switch (value) {
    case "open":
    case "closed":
    case "bootstrap":
      return value
    default:
      return "bootstrap"
  }
}

async function hasExistingUsers() {
  const result = await pool.query('select 1 from "user" limit 1')
  return (result.rowCount ?? 0) > 0
}

export async function getSignupPolicy(): Promise<SignupPolicy> {
  const mode = normalizeSignupMode(process.env.AUTH_SIGNUP_MODE)

  if (mode === "open") {
    return { mode, open: true }
  }

  if (mode === "closed") {
    return {
      mode,
      open: false,
      reason: "Public sign-up is disabled by policy (AUTH_SIGNUP_MODE=closed).",
    }
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return {
      mode,
      open: false,
      reason:
        "Bootstrap sign-up cannot be evaluated because DATABASE_URL is not configured.",
    }
  }

  try {
    const usersExist = await hasExistingUsers()
    return usersExist
      ? {
          mode,
          open: false,
          reason:
            "Bootstrap sign-up is closed because at least one operator account already exists.",
        }
      : {
          mode,
          open: true,
          reason: "Bootstrap sign-up is open until the first operator account is created.",
        }
  } catch (error) {
    return {
      mode,
      open: false,
      reason:
        error instanceof Error
          ? `Bootstrap sign-up check failed: ${error.message}`
          : "Bootstrap sign-up check failed.",
    }
  }
}
