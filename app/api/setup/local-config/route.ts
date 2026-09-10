import path from "node:path"
import { promises as fs } from "node:fs"
import { NextResponse } from "next/server"
import {
  normalizePortableAbsolutePathIdentity,
  normalizeProjectRootForEnv,
  serializeProjectRootEnvValue,
} from "@/lib/setup/project-root-env"
import { getAuthReadiness } from "@/lib/auth-readiness"
import { guardLineRequest, readBoundedJson } from "@/lib/environment/line-guard"
import { assertOwner, resolveOwnerUserId } from "@/lib/governance/owner"
import { ownerLookup } from "@/lib/governance/owner-lookup"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"
import {
  verifyCanonicalTerraFusionCheckout,
  verifyTerraFusionWorkspaceRoot,
} from "@/lib/projects/workspace-project-binding"
import { getSession } from "@/lib/session"

export const runtime = "nodejs"

type SetupPayload = {
  operation?: unknown
  databaseUrl?: unknown
  authSecret?: unknown
  authUrl?: unknown
  terraFusionRoot?: unknown
  repositoryKey?: unknown
  repositoryRoot?: unknown
}

type SetupOperation = "full" | "terrafusion-root" | "terrafusion-repository-root"

const MAX_SETUP_REQUEST_BYTES = 16_000

function localSetupEnabled() {
  if (process.env.LOCAL_SETUP_ENABLED === "false") return false
  if (process.env.LOCAL_SETUP_ENABLED === "true") return true
  return process.env.NODE_ENV !== "production"
}

/**
 * Evidence that a request did NOT come straight from this machine.
 *
 * The loopback check reads the Host header, which the caller controls, so on its own it proves
 * nothing. Today this route is safe for two reasons that live in other files: the standalone server
 * forces NODE_ENV=production, and the HERMES proxy overwrites Host before forwarding. Both are
 * correct and neither is visible from here -- someone making the proxy preserve the original Host,
 * which looks like a fix, would quietly expose an unauthenticated rewrite of DATABASE_URL and
 * BETTER_AUTH_SECRET in any non-production deployment.
 *
 * A client connecting directly to the loopback socket does not set forwarding headers. The proxy
 * always does. That asymmetry is checkable here and does not depend on anyone else's care.
 */
function wasForwarded(headers: Headers) {
  return headers.has("x-forwarded-host") || headers.has("x-forwarded-for") || headers.has("forwarded")
}

function isLoopbackHost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function validateTerraFusionRoot(value: unknown) {
  const terraFusionRoot = asTrimmedString(value)
  if (!terraFusionRoot) {
    throw new Error("WILLIAMOS_TERRAFUSION_ROOT is required.")
  }
  if (!path.isAbsolute(terraFusionRoot) || terraFusionRoot.includes("\0") || terraFusionRoot.length > 4096) {
    throw new Error("WILLIAMOS_TERRAFUSION_ROOT must be an absolute path to the TerraFusion checkout.")
  }

  const normalizedTerraFusionRoot = normalizeProjectRootForEnv(path.resolve(terraFusionRoot))
  serializeProjectRootEnvValue(normalizedTerraFusionRoot)
  return normalizedTerraFusionRoot
}

function parseOperation(payload: SetupPayload): SetupOperation {
  const operation = asTrimmedString(payload.operation) || "full"
  if (
    operation !== "full"
    && operation !== "terrafusion-root"
    && operation !== "terrafusion-repository-root"
  ) {
    throw new Error("Unsupported setup operation.")
  }
  return operation
}

function validateFullPayload(payload: SetupPayload) {
  const databaseUrl = asTrimmedString(payload.databaseUrl)
  const authSecret = asTrimmedString(payload.authSecret)
  const authUrl = asTrimmedString(payload.authUrl)

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.")
  }
  if (!authSecret) {
    throw new Error("BETTER_AUTH_SECRET is required.")
  }
  if (authSecret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.")
  }
  if (!authUrl) {
    throw new Error("BETTER_AUTH_URL is required.")
  }
  try {
    new URL(authUrl)
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid URL.")
  }

  return {
    databaseUrl,
    authSecret,
    authUrl,
    terraFusionRoot: validateTerraFusionRoot(payload.terraFusionRoot),
  }
}

function envLine(key: string, value: string) {
  return `${key}=${JSON.stringify(value)}`
}

function declaredEnvValue(existing: string, key: string): string | null {
  const keyPattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`)
  for (const line of existing.split(/\r?\n/)) {
    const match = line.match(keyPattern)
    if (!match) continue
    const raw = match[1].trim()
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        const parsed = JSON.parse(raw)
        return typeof parsed === "string" ? parsed.trim() || null : null
      } catch {
        return null
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).trim() || null
    return raw || null
  }
  return null
}

function stableTerraFusionSpaceIdentity(existing: string, nextRoot: string): string {
  const identity = declaredEnvValue(existing, "WILLIAMOS_TERRAFUSION_SPACE_IDENTITY")
    ?? declaredEnvValue(existing, "WILLIAMOS_TERRAFUSION_ROOT")
    ?? nextRoot
  return normalizePortableAbsolutePathIdentity(identity)
}

async function writeManagedLocalEnv(
  managedEntriesFor: Map<string, string> | ((existing: string) => Map<string, string>),
) {
  const envPath = path.join(process.cwd(), ".env.local")

  let existing = ""
  try {
    existing = await fs.readFile(envPath, "utf8")
  } catch (error) {
    const errnoError = error as NodeJS.ErrnoException
    if (errnoError.code !== "ENOENT") {
      throw error
    }
  }
  const managedEntries = typeof managedEntriesFor === "function"
    ? managedEntriesFor(existing)
    : managedEntriesFor

  const nextLines: string[] = []
  const seenKeys = new Set<string>()
  const keyPattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/

  if (existing) {
    for (const line of existing.split(/\r?\n/)) {
      const match = line.match(keyPattern)
      const key = match?.[1]
      if (key && managedEntries.has(key)) {
        if (!seenKeys.has(key)) {
          nextLines.push(managedEntries.get(key)!)
          seenKeys.add(key)
        }
        continue
      }

      nextLines.push(line)
    }
  } else {
    nextLines.push("# Generated by /setup local owner provisioning assistant")
  }

  for (const [key, line] of managedEntries) {
    if (!seenKeys.has(key)) {
      nextLines.push(line)
    }
  }

  await fs.writeFile(envPath, `${nextLines.join("\n").replace(/\n+$/, "")}\n`, "utf8")
}

async function writeFullLocalEnv(input: {
  databaseUrl: string
  authSecret: string
  authUrl: string
  terraFusionRoot: string
}) {
  const optionalEntries: [string, string][] = process.env.GROQ_API_KEY
    ? [["GROQ_API_KEY", envLine("GROQ_API_KEY", process.env.GROQ_API_KEY)]]
    : []
  await writeManagedLocalEnv((existing) => {
    const spaceIdentity = stableTerraFusionSpaceIdentity(existing, input.terraFusionRoot)
    return new Map<string, string>([
      ["DATABASE_URL", envLine("DATABASE_URL", input.databaseUrl)],
      ["BETTER_AUTH_SECRET", envLine("BETTER_AUTH_SECRET", input.authSecret)],
      ["BETTER_AUTH_URL", envLine("BETTER_AUTH_URL", input.authUrl)],
      ["WILLIAMOS_TERRAFUSION_ROOT", `WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(input.terraFusionRoot)}`],
      ["WILLIAMOS_TERRAFUSION_SPACE_IDENTITY", `WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue(spaceIdentity)}`],
      ["LOCAL_SETUP_ENABLED", envLine("LOCAL_SETUP_ENABLED", "true")],
      ...optionalEntries,
    ])
  })
}

async function writeTerraFusionRoot(terraFusionRoot: string) {
  await writeManagedLocalEnv((existing) => {
    const spaceIdentity = stableTerraFusionSpaceIdentity(existing, terraFusionRoot)
    return new Map([
      ["WILLIAMOS_TERRAFUSION_ROOT", `WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(terraFusionRoot)}`],
      ["WILLIAMOS_TERRAFUSION_SPACE_IDENTITY", `WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue(spaceIdentity)}`],
    ])
  })
}

async function writeTerraFusionRepositoryRoot(
  environmentKey: string,
  repositoryRoot: string,
) {
  await writeManagedLocalEnv(new Map([
    [environmentKey, `${environmentKey}=${serializeProjectRootEnvValue(repositoryRoot)}`],
  ]))
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  if (!isLoopbackHost(url)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup assistant only accepts loopback requests. Use localhost when running setup.",
      },
      { status: 403 },
    )
  }

  const requestRejection = guardLineRequest(req)
  if (requestRejection) {
    return NextResponse.json(
      { ok: false, message: requestRejection.error },
      { status: requestRejection.status },
    )
  }

  const parsedBody = await readBoundedJson(req, MAX_SETUP_REQUEST_BYTES)
  if (!parsedBody.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: parsedBody.error === "MESSAGE_TOO_LARGE"
          ? "Setup payload is too large."
          : "Invalid JSON payload.",
      },
      { status: parsedBody.status },
    )
  }
  const payload = parsedBody.value as SetupPayload

  let operation: SetupOperation
  try {
    operation = parseOperation(payload)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid setup payload.",
      },
      { status: 400 },
    )
  }

  if (!localSetupEnabled() && operation === "full") {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup assistant is disabled in this environment. Contact your platform administrator.",
      },
      { status: 403 },
    )
  }

  if (operation === "full" && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        message: "Full local bootstrap is disabled in production. Use the authenticated owner mount operations only.",
      },
      { status: 403 },
    )
  }

  if (operation === "terrafusion-root" || operation === "terrafusion-repository-root") {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json(
        { ok: false, message: "Authentication is required to change the TerraFusion checkout." },
        { status: 401 },
      )
    }

    const readiness = await getAuthReadiness({ probeDatabase: true })
    if (!readiness.ready) {
      return NextResponse.json(
        {
          ok: false,
          message: "TerraFusion checkout setup requires an authentication-ready WilliamOS instance.",
        },
        { status: 409 },
      )
    }

    const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
    const owner = assertOwner(session.user.id, ownerId)
    if (!owner.ok) {
      return NextResponse.json(
        { ok: false, message: owner.failure === "NOT_OWNER" ? "Only the WilliamOS owner can change the TerraFusion checkout." : owner.detail },
        { status: owner.failure === "NOT_OWNER" ? 403 : 409 },
      )
    }

    let terraFusionRoot: string
    try {
      terraFusionRoot = validateTerraFusionRoot(
        operation === "terrafusion-root" ? payload.terraFusionRoot : payload.repositoryRoot,
      )
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error instanceof Error ? error.message : "Invalid TerraFusion checkout path.",
        },
        { status: 400 },
      )
    }

    const repositorySelection = operation === "terrafusion-repository-root"
      ? resolveWorkspaceRepositorySelection("terrafusion", payload.repositoryKey)
      : resolveWorkspaceRepositorySelection("terrafusion", "os-1")
    if (!repositorySelection.ok) {
      return NextResponse.json(
        { ok: false, message: `TerraFusion repository selection failed: ${repositorySelection.error}` },
        { status: 400 },
      )
    }

    const verifiedRoot = repositorySelection.repository.key === "os-1"
      ? await verifyTerraFusionWorkspaceRoot(session.user.id, terraFusionRoot)
      : await verifyCanonicalTerraFusionCheckout(
        terraFusionRoot,
        repositorySelection.repository.identity,
      )
    if (!verifiedRoot.ok) {
      return NextResponse.json(
        { ok: false, message: `TerraFusion checkout verification failed: ${verifiedRoot.error}` },
        { status: 409 },
      )
    }
    terraFusionRoot = verifiedRoot.binding.configuredWorkspaceRoot

    try {
      if (repositorySelection.repository.key === "os-1") {
        await writeTerraFusionRoot(terraFusionRoot)
      } else {
        await writeTerraFusionRepositoryRoot(
          repositorySelection.repository.configuredRootEnvironment,
          terraFusionRoot,
        )
      }
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error instanceof Error
            ? `Failed to write .env.local: ${error.message}`
            : "Failed to write .env.local",
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      repositoryKey: repositorySelection.repository.key,
      message: `Saved the ${repositorySelection.repository.label} checkout to .env.local. Restart WilliamOS to connect it.`,
      restartRequired: true,
    })
  }

  // Full bootstrap can replace database and authentication authority. It remains restricted to a
  // direct loopback client. Next's normal browser route adds forwarding headers, so only the
  // authenticated, CSRF-guarded TerraFusion-root operation is allowed through that path.
  if (wasForwarded(req.headers)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Local setup assistant only accepts loopback requests. Use localhost when running setup.",
      },
      { status: 403 },
    )
  }

  if ((process.env.AUTH_SIGNUP_MODE ?? "bootstrap") === "closed") {
    return NextResponse.json(
      {
        ok: false,
        message: "Local setup assistant is disabled because owner provisioning is closed.",
      },
      { status: 403 },
    )
  }

  let validated: ReturnType<typeof validateFullPayload>
  try {
    validated = validateFullPayload(payload)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid setup payload.",
      },
      { status: 400 },
    )
  }


  const verifiedBootstrapRoot = await verifyCanonicalTerraFusionCheckout(validated.terraFusionRoot)
  if (!verifiedBootstrapRoot.ok) {
    return NextResponse.json(
      { ok: false, message: `TerraFusion checkout verification failed: ${verifiedBootstrapRoot.error}` },
      { status: 409 },
    )
  }
  validated.terraFusionRoot = verifiedBootstrapRoot.binding.configuredWorkspaceRoot

  try {
    await writeFullLocalEnv(validated)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? `Failed to write .env.local: ${error.message}`
            : "Failed to write .env.local",
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    message:
      "Saved setup to .env.local. Restart the app process to apply the new environment variables.",
    restartRequired: true,
  })
}
