import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
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

function isSameOriginLoopback(value: string | null, expectedOrigin: string) {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.origin === expectedOrigin && isLoopbackHost(parsed)
  } catch {
    return false
  }
}

function isLocalSetupRequest(req: Request) {
  const url = new URL(req.url)
  const origin = req.headers.get("origin")
  const referer = req.headers.get("referer")

  return (
    isLoopbackHost(url) &&
    Boolean(origin || referer) &&
    (!origin || isSameOriginLoopback(origin, url.origin)) &&
    (!referer || isSameOriginLoopback(referer, url.origin))
  )
}

async function getPrimaryRecordState(client: PoolClient) {
  const result = await client.query<{
    auth_record_count: number
    declared_primary_count: number
  }>(
    `select
      count(*)::int as auth_record_count,
      count(*) filter (where lower(email) = lower($1))::int as declared_primary_count
    from "user"`,
    [DECLARED_PRIMARY_EMAIL],
  )

  return {
    anyAuthRecordsExist: (result.rows[0]?.auth_record_count ?? 0) > 0,
    declaredPrimaryExists: (result.rows[0]?.declared_primary_count ?? 0) > 0,
  }
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  let transactionStarted = false
  try {
    await client.query("begin")
    transactionStarted = true
    const result = await fn(client)
    await client.query("commit")
    return result
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("rollback")
      } catch {
        // Preserve the original setup failure; rollback errors are secondary.
      }
    }
    throw error
  } finally {
    client.release()
  }
}

async function provisionPrimary(client: PoolClient, input: {
  email: string
  name: string
  passwordHash: string
}) {
  const userId = randomUUID()
  const accountId = randomUUID()

  await client.query(
    'insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())',
    [userId, input.name, input.email],
  )
  await client.query(
    'insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())',
    [accountId, input.email, "credential", userId, input.passwordHash],
  )
}

async function recoverPrimary(
  client: PoolClient,
  input: { email: string; passwordHash: string },
) {
  const primary = await client.query<{ id: string }>(
    'select id from "user" where lower(email) = lower($1) limit 1',
    [input.email],
  )
  const primaryId = primary.rows[0]?.id

  if (!primaryId) {
    return false
  }

  const updated = await client.query(
    'update account set password = $1, "updatedAt" = now() where "userId" = $2 and "providerId" = $3',
    [input.passwordHash, primaryId, "credential"],
  )

  if ((updated.rowCount ?? 0) === 0) {
    await client.query(
      'insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, now(), now())',
      [randomUUID(), input.email, "credential", primaryId, input.passwordHash],
    )
  }

  await client.query('delete from session where "userId" = $1', [primaryId])
  return true
}

export async function POST(req: Request) {
  if (!localSetupEnabled()) {
    return NextResponse.json(
      { ok: false, message: "Primary credential setup is disabled in this environment." },
      { status: 403 },
    )
  }

  if (!isLocalSetupRequest(req)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Primary credential setup only accepts same-origin loopback setup requests.",
      },
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
    const passwordHash = await hashPassword(input.password)

    const result = await withTransaction(async (client) => {
      const operation = classifyPrimaryCredentialOperation(
        await getPrimaryRecordState(client),
      )

      if (operation === "blocked_identity_missing") {
        return {
          ok: false as const,
          status: 409,
          operation,
          message:
            "Primary identity is not declared in the local auth records. Resolve identity before credential recovery.",
        }
      }

      if (operation === "provisioning") {
        await provisionPrimary(client, {
          email: input.email,
          name: input.name,
          passwordHash,
        })
        return {
          ok: true as const,
          operation,
          message: "Primary credential established. Continue to Primary Access.",
        }
      }

      const recovered = await recoverPrimary(client, {
        email: input.email,
        passwordHash,
      })
      if (!recovered) {
        return {
          ok: false as const,
          status: 404,
          operation,
          message:
            "No matching Primary record was found for that email. Credential recovery did not run.",
        }
      }

      return {
        ok: true as const,
        operation,
        message: "Primary credential recovered. Continue to Primary Access.",
      }
    })

    if (!result.ok) {
      return NextResponse.json(result, { status: result.status })
    }

    if (result.operation === "provisioning") {
      return NextResponse.json({
        ok: true,
        operation: result.operation,
        message: result.message,
      })
    }

    return NextResponse.json({
      ok: true,
      operation: result.operation,
      message: result.message,
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
