import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { NextResponse } from "next/server"
import { hashPassword } from "better-auth/crypto"
import { pool } from "@/lib/db"
import {
  classifyPrimaryCredentialOperation,
  validatePrimaryCredentialPayload,
  type PrimaryCredentialPayload,
} from "@/lib/primary-credential"
import { DECLARED_PRIMARY_EMAIL, isDeclaredPrimaryEmail } from "@/lib/primary-identity"
import {
  isLoopbackHost as isLoopbackHostname,
  localSetupEnabled,
  primaryRecoveryEnabled,
} from "@/lib/setup/local-setup-enabled"

export const runtime = "nodejs"

/**
 * The request URL is loopback when its HOST is. The host predicate lives in
 * `@/lib/setup/local-setup-enabled` so the three setup routes cannot disagree about which hosts
 * count as "this machine"; this wrapper only adapts a `URL` to it.
 */
function isLoopbackHost(url: URL) {
  return isLoopbackHostname(url.hostname)
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

/**
 * The refusal for an operation this environment is not configured to perform, or `null` when the
 * operation may proceed.
 *
 * Evaluated BEFORE the password is hashed and before any transaction is opened. `hashPassword` is
 * deliberately expensive and a pooled connection is a shared resource, so a request this surface is
 * already going to refuse must spend neither: repeated refusals would otherwise consume real CPU and
 * connection-pool capacity on a loopback surface reachable by any local process.
 */
function setupGateRefusal(operation: ReturnType<typeof classifyPrimaryCredentialOperation>) {
  const allowed = operation === "recovery" ? primaryRecoveryEnabled() : localSetupEnabled()
  if (allowed) return null
  return {
    status: 403 as const,
    operation,
    message: operation === "recovery"
      ? "Primary credential recovery is not armed in this environment. Recovery is a deliberate, "
        + "process-only opt-in (WILLIAMOS_PRIMARY_RECOVERY=true) that setup never persists; it "
        + "cannot be enabled by LOCAL_SETUP_ENABLED."
      : "Primary credential provisioning is not enabled in this environment. Contact your platform "
        + "administrator.",
  }
}

async function getPrimaryRecordState(client: Pool | PoolClient) {
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

  // Classify and refuse BEFORE the expensive work. A cheap read on the pool answers "what would this
  // request do"; if the environment is not configured for that operation the request ends here,
  // without hashing a password and without borrowing a pooled connection.
  let declaredOperation: ReturnType<typeof classifyPrimaryCredentialOperation>
  try {
    declaredOperation = classifyPrimaryCredentialOperation(await getPrimaryRecordState(pool))
  } catch {
    return NextResponse.json(
      { ok: false, message: "Primary credential state is unavailable." },
      { status: 503 },
    )
  }
  if (declaredOperation === "blocked_identity_missing") {
    // Decided here, not inside the transaction: this refusal is the same whether or not the work
    // runs, so it must not borrow a pooled client or hash a password to discover it.
    return NextResponse.json(
      {
        ok: false,
        operation: declaredOperation,
        message:
          "Primary identity is not declared in the local auth records. Resolve identity before credential recovery.",
      },
      { status: 409 },
    )
  }
  {
    const refusal = setupGateRefusal(declaredOperation)
    if (refusal) return NextResponse.json({ ok: false, ...refusal }, { status: refusal.status })
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

      // Re-evaluated inside the transaction: the pre-flight classification is a cheap read taken
      // outside it, so the state could have moved between the two. The refusal is identical.
      const setupRefusal = setupGateRefusal(operation)
      if (setupRefusal) {
        return { ok: false as const, ...setupRefusal }
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
