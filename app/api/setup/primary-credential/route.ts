import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { hashPassword } from "better-auth/crypto"
import { pool } from "@/lib/db"
import {
  classifyPrimaryCredentialOperation,
  validatePrimaryCredentialPayload,
  type PrimaryCredentialPayload,
} from "@/lib/primary-credential"
import { DECLARED_PRIMARY_EMAIL, isDeclaredPrimaryEmail } from "@/lib/primary-identity"

export const runtime = "nodejs"

function localSetupEnabled() {
  if (process.env.LOCAL_SETUP_ENABLED === "false") return false
  return process.env.NODE_ENV !== "production"
}

function isLoopbackHost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
}

async function declaredPrimaryExists() {
  const result = await pool.query<{ count: number }>(
    'select count(*)::int as count from "user" where lower(email) = lower($1)',
    [DECLARED_PRIMARY_EMAIL],
  )
  return (result.rows[0]?.count ?? 0) > 0
}

async function provisionPrimary(input: {
  email: string
  name: string
  passwordHash: string
}) {
  const userId = randomUUID()
  const accountId = randomUUID()

  await pool.query("begin")
  try {
    await pool.query(
      'insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())',
      [userId, input.name, input.email],
    )
    await pool.query(
      'insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())',
      [accountId, input.email, "credential", userId, input.passwordHash],
    )
    await pool.query("commit")
  } catch (error) {
    await pool.query("rollback")
    throw error
  }
}

async function recoverPrimary(input: { email: string; passwordHash: string }) {
  await pool.query("begin")
  try {
    const primary = await pool.query<{ id: string }>(
      'select id from "user" where lower(email) = lower($1) limit 1',
      [input.email],
    )
    const primaryId = primary.rows[0]?.id

    if (!primaryId) {
      await pool.query("rollback")
      return false
    }

    const updated = await pool.query(
      'update account set password = $1, "updatedAt" = now() where "userId" = $2 and "providerId" = $3',
      [input.passwordHash, primaryId, "credential"],
    )

    if ((updated.rowCount ?? 0) === 0) {
      await pool.query(
        'insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())',
        [randomUUID(), input.email, "credential", primaryId, input.passwordHash],
      )
    }

    await pool.query('delete from session where "userId" = $1', [primaryId])
    await pool.query("commit")
    return true
  } catch (error) {
    await pool.query("rollback")
    throw error
  }
}

export async function POST(req: Request) {
  if (!localSetupEnabled()) {
    return NextResponse.json(
      { ok: false, message: "Primary credential setup is disabled in this environment." },
      { status: 403 },
    )
  }

  const url = new URL(req.url)
  if (!isLoopbackHost(url)) {
    return NextResponse.json(
      { ok: false, message: "Primary credential setup only accepts loopback requests." },
      { status: 403 },
    )
  }

  let payload: PrimaryCredentialPayload
  try {
    payload = (await req.json()) as PrimaryCredentialPayload
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 })
  }

  let input
  try {
    input = validatePrimaryCredentialPayload(payload)
    if (!isDeclaredPrimaryEmail(input.email)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Primary credential recovery is limited to the declared Primary identity.",
        },
        { status: 403 },
      )
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid Primary credential payload.",
      },
      { status: 400 },
    )
  }

  try {
    const operation = classifyPrimaryCredentialOperation(await declaredPrimaryExists())
    const passwordHash = await hashPassword(input.password)

    if (operation === "provisioning") {
      await provisionPrimary({ email: input.email, name: input.name, passwordHash })
      return NextResponse.json({
        ok: true,
        operation,
        message: "Primary credential established. Continue to Primary Access.",
      })
    }

    const recovered = await recoverPrimary({ email: input.email, passwordHash })
    if (!recovered) {
      return NextResponse.json(
        {
          ok: false,
          operation,
          message:
            "No matching Primary record was found for that email. Credential recovery did not run.",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      operation,
      message: "Primary credential recovered. Continue to Primary Access.",
    })
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Primary credential setup failed.",
      },
      { status: 500 },
    )
  }
}
