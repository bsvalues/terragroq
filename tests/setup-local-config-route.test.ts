import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRequire } from "node:module"
import path from "node:path"

const writeFileMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())
const getAuthReadinessMock = vi.hoisted(() => vi.fn())
const getSessionMock = vi.hoisted(() => vi.fn())
const resolveOwnerUserIdMock = vi.hoisted(() => vi.fn())
const assertOwnerMock = vi.hoisted(() => vi.fn())
const verifyTerraFusionWorkspaceRootMock = vi.hoisted(() => vi.fn())
const verifyCanonicalTerraFusionCheckoutMock = vi.hoisted(() => vi.fn())

vi.mock("node:fs", () => ({
  promises: {
    writeFile: writeFileMock,
    readFile: readFileMock,
  },
}))

vi.mock("@/lib/auth-readiness", () => ({
  getAuthReadiness: getAuthReadinessMock,
}))

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
}))

vi.mock("@/lib/governance/owner", () => ({
  resolveOwnerUserId: resolveOwnerUserIdMock,
  assertOwner: assertOwnerMock,
}))

vi.mock("@/lib/governance/owner-lookup", () => ({ ownerLookup: vi.fn(() => ({})) }))

vi.mock("@/lib/projects/workspace-project-binding", () => ({
  verifyTerraFusionWorkspaceRoot: verifyTerraFusionWorkspaceRootMock,
  verifyCanonicalTerraFusionCheckout: verifyCanonicalTerraFusionCheckoutMock,
}))

import { POST } from "@/app/api/setup/local-config/route"
import {
  normalizeProjectRootForEnv,
  serializeProjectRootEnvValue,
} from "@/lib/setup/project-root-env"

const nodeRequire = createRequire(import.meta.url)

function parseWithNextDotenv(input: string): Record<string, string> {
  const nextDirectory = path.dirname(nodeRequire.resolve("next/package.json"))
  const nextEnvPackage = nodeRequire.resolve("@next/env/package.json", { paths: [nextDirectory] })
  const dotenvEntry = nodeRequire.resolve("dotenv", { paths: [path.dirname(nextEnvPackage)] })
  return (nodeRequire(dotenvEntry) as { parse: (value: string) => Record<string, string> }).parse(input)
}

function processWithNextEnv(input: string): string | undefined {
  const nextDirectory = path.dirname(nodeRequire.resolve("next/package.json"))
  const nextEnvEntry = nodeRequire.resolve("@next/env", { paths: [nextDirectory] })
  const nextEnv = nodeRequire(nextEnvEntry) as {
    processEnv: (
      files: Array<{ path: string; contents: string; env: Record<string, string> }>,
      directory: string,
      logger: { error: () => void },
      forceReload: boolean,
    ) => [NodeJS.ProcessEnv, Record<string, string>]
  }
  const previousRoot = process.env.WILLIAMOS_TERRAFUSION_ROOT
  const previousProcessed = process.env.__NEXT_PROCESSED_ENV
  delete process.env.WILLIAMOS_TERRAFUSION_ROOT
  delete process.env.__NEXT_PROCESSED_ENV
  try {
    const [, parsed] = nextEnv.processEnv(
      [{ path: ".env.local", contents: input, env: {} }],
      process.cwd(),
      { error: () => undefined },
      true,
    )
    return parsed.WILLIAMOS_TERRAFUSION_ROOT
  } finally {
    if (previousRoot === undefined) delete process.env.WILLIAMOS_TERRAFUSION_ROOT
    else process.env.WILLIAMOS_TERRAFUSION_ROOT = previousRoot
    if (previousProcessed === undefined) delete process.env.__NEXT_PROCESSED_ENV
    else process.env.__NEXT_PROCESSED_ENV = previousProcessed
  }
}

describe("POST /api/setup/local-config route contract", () => {
  const originalEnv = process.env
  const projectRoot = path.resolve("/repos/terrafusion_os_1.0")
  const normalizedProjectRoot = normalizeProjectRootForEnv(projectRoot)

  beforeEach(() => {
    vi.clearAllMocks()
    writeFileMock.mockResolvedValue(undefined)
    readFileMock.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }))
    process.env = { ...originalEnv }
    process.env.NODE_ENV = "development"
    delete process.env.LOCAL_SETUP_ENABLED
    delete process.env.AUTH_SIGNUP_MODE
    delete process.env.GROQ_API_KEY
    getAuthReadinessMock.mockResolvedValue({ ready: true })
    getSessionMock.mockResolvedValue({ user: { id: "owner" } })
    resolveOwnerUserIdMock.mockResolvedValue("owner")
    assertOwnerMock.mockReturnValue({ ok: true })
    verifyTerraFusionWorkspaceRootMock.mockImplementation(async (_userId: string, root: string) => ({
      ok: true,
      binding: { configuredWorkspaceRoot: root, workspaceRoot: root },
    }))
    verifyCanonicalTerraFusionCheckoutMock.mockImplementation(async (root: string) => ({
      ok: true,
      binding: { configuredWorkspaceRoot: root, workspaceRoot: root },
    }))
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("rejects requests when local setup is disabled", async () => {
    process.env.LOCAL_SETUP_ENABLED = "false"

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("disabled")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects non-loopback requests", async () => {
    const req = new Request("http://example.com/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("loopback")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects a loopback-looking request that was actually forwarded by the proxy", async () => {
    // Host is set by the caller, so it cannot establish locality on its own. A request that carries
    // forwarding headers reached this server through the proxy and is therefore not a local client,
    // whatever it claims its Host to be.
    const req = new Request("http://localhost/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": "192.168.88.9:3443",
      },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("bounds a forwarded full-bootstrap body before rejecting it", async () => {
    const req = new Request("http://localhost/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": "192.168.88.9:3443",
      },
      body: JSON.stringify({ ignored: "x".repeat(20_000) }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(req.headers.has("content-length")).toBe(false)
    expect(response.status).toBe(413)
    expect(body.message).toContain("too large")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("allows authenticated root-only setup through Next's same-origin forwarded request", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        "X-Forwarded-Host": "localhost:3000",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it("persists a secondary Core Seven mount from the server catalog only", async () => {
    readFileMock.mockResolvedValue([
      'DATABASE_URL="postgres://existing"',
      'WILLIAMOS_TERRAFUSION_ROOT="C:/repos/terrafusion_os_1.0"',
      'WILLIAMOS_TERRAFUSION_ATLAS_ROOT="C:/repos/old-atlas"',
      "CUSTOM_FLAG=true",
      "",
    ].join("\n"))
    const atlasRoot = path.resolve("/repos/terrafusion-atlas")
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "terrafusion-repository-root",
        repositoryKey: "atlas",
        repositoryRoot: atlasRoot,
        configuredRootEnvironment: "ATTACKER_CHOSEN_ENV",
        repositoryIdentity: "attacker/repository",
      }),
    })

    const response = await POST(req)
    const body = await response.json()
    const writtenEnv = writeFileMock.mock.calls[0][1] as string

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, repositoryKey: "atlas", restartRequired: true })
    expect(verifyCanonicalTerraFusionCheckoutMock).toHaveBeenCalledWith(
      normalizeProjectRootForEnv(atlasRoot),
      "bsvalues/terrafusion-atlas",
    )
    expect(writtenEnv).toContain("CUSTOM_FLAG=true")
    expect(writtenEnv).toContain('DATABASE_URL="postgres://existing"')
    expect(writtenEnv).toContain(
      `WILLIAMOS_TERRAFUSION_ATLAS_ROOT=${serializeProjectRootEnvValue(normalizeProjectRootForEnv(atlasRoot))}`,
    )
    expect(writtenEnv).not.toContain("ATTACKER_CHOSEN_ENV")
    expect(writtenEnv).not.toContain("attacker/repository")
    expect(writtenEnv).not.toContain('WILLIAMOS_TERRAFUSION_ATLAS_ROOT="C:/repos/old-atlas"')
  })

  it("rejects a secondary mount key that is not in the Core Seven catalog", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "terrafusion-repository-root",
        repositoryKey: "terrafusion-sync",
        repositoryRoot: path.resolve("/repos/terrafusion-sync"),
      }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.message).toContain("WORKSPACE_REPOSITORY_UNKNOWN")
    expect(verifyCanonicalTerraFusionCheckoutMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("allows an explicitly enabled owner mount change in the production HERMES process", async () => {
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "true"
    const atlasRoot = path.resolve("/repos/terrafusion-atlas")
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://192.168.88.9:3443",
        "X-Forwarded-Host": "192.168.88.9:3443",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        operation: "terrafusion-repository-root",
        repositoryKey: "atlas",
        repositoryRoot: atlasRoot,
      }),
    })

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(verifyCanonicalTerraFusionCheckoutMock).toHaveBeenCalledWith(
      normalizeProjectRootForEnv(atlasRoot),
      "bsvalues/terrafusion-atlas",
    )
    expect(writeFileMock).toHaveBeenCalledTimes(1)
  })

  it("keeps full bootstrap disabled when production mount setup is explicitly enabled", async () => {
    process.env.NODE_ENV = "production"
    process.env.LOCAL_SETUP_ENABLED = "true"
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "full",
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        terraFusionRoot: projectRoot,
      }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.message).toContain("Full local bootstrap is disabled in production")
    expect(verifyCanonicalTerraFusionCheckoutMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("refuses a secondary checkout whose origin does not match the selected catalog identity", async () => {
    verifyCanonicalTerraFusionCheckoutMock.mockResolvedValueOnce({
      ok: false,
      error: "WORKSPACE_ROOT_PROJECT_MISMATCH",
    })
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "terrafusion-repository-root",
        repositoryKey: "dossier",
        repositoryRoot: path.resolve("/repos/not-dossier"),
      }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.message).toContain("WORKSPACE_ROOT_PROJECT_MISMATCH")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("refuses unauthenticated root-only setup without writing", async () => {
    getSessionMock.mockResolvedValueOnce(null)
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.message).toContain("Authentication is required")
    expect(getAuthReadinessMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("refuses a non-owner root-only setup without verifying or writing", async () => {
    assertOwnerMock.mockReturnValueOnce({ ok: false, failure: "NOT_OWNER", detail: "owner mismatch" })
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    expect(verifyTerraFusionWorkspaceRootMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("refuses an owner-selected checkout that does not verify as canonical TerraFusion", async () => {
    verifyTerraFusionWorkspaceRootMock.mockResolvedValueOnce({
      ok: false,
      error: "WORKSPACE_ROOT_PROJECT_MISMATCH",
    })
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    })

    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.message).toContain("WORKSPACE_ROOT_PROJECT_MISMATCH")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("refuses a cross-origin root-only request before writing", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        "X-Forwarded-Host": "localhost:3000",
        "X-Forwarded-Proto": "http",
      },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    })

    const response = await POST(req)

    expect(response.status).toBe(403)
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("rejects writes when signup mode is closed", async () => {
    process.env.AUTH_SIGNUP_MODE = "closed"

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("owner provisioning is closed")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid JSON payloads", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.message).toBe("Invalid JSON payload.")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("validates required env values before writing", async () => {
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "",
        authSecret: "short",
        authUrl: "not-a-url",
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.ok).toBe(false)
    expect(body.message).toBe("DATABASE_URL is required.")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it.each([
    "",
    "relative/terrafusion_os_1.0",
    path.join(projectRoot, "owner's-checkout"),
    path.join(projectRoot, "$workspace"),
  ])(
    "requires an absolute TerraFusion checkout path (%s)",
    async (invalidProjectRoot) => {
      const req = new Request("http://localhost:3000/api/setup/local-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
          authSecret: "12345678901234567890123456789012",
          authUrl: "http://localhost:3000",
          terraFusionRoot: invalidProjectRoot,
        }),
      })

      const response = await POST(req)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.message).toContain("WILLIAMOS_TERRAFUSION_ROOT")
      expect(writeFileMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    "C:\\repos\\terrafusion_os_1.0",
    "C:\\new\\terrafusion_os_1.0",
    "\\\\omen\\workspace\\terrafusion_os_1.0",
  ])("round-trips a Windows checkout root through Next's dotenv parser (%s)", (windowsRoot) => {
    const normalized = normalizeProjectRootForEnv(windowsRoot, "win32")
    const line = `WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalized)}\n`
    const parsed = parseWithNextDotenv(line)

    expect(normalized).not.toContain("\\")
    expect(parsed.WILLIAMOS_TERRAFUSION_ROOT).toBe(normalized)
    expect(processWithNextEnv(line)).toBe(normalized)
  })

  it("preserves a literal backslash in a POSIX checkout root", () => {
    const posixRoot = "/srv/terrafusion\\repo\"quoted"
    const normalized = normalizeProjectRootForEnv(posixRoot, "linux")
    const line = `WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalized)}\n`
    const parsed = parseWithNextDotenv(line)

    expect(normalized).toBe(posixRoot)
    expect(parsed.WILLIAMOS_TERRAFUSION_ROOT).toBe(posixRoot)
    expect(processWithNextEnv(line)).toBe(posixRoot)
  })

  it("writes .env.local with expected keys on valid setup payload", async () => {
    process.env.GROQ_API_KEY = "groq-key-value"
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        terraFusionRoot: projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.restartRequired).toBe(true)
    expect(writeFileMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock.mock.calls[0][0]).toMatch(/\.env\.local$/)
    expect(writeFileMock.mock.calls[0][1]).toContain(
      'DATABASE_URL="postgres://postgres:postgres@localhost:5432/terragroq"',
    )
    expect(writeFileMock.mock.calls[0][1]).toContain(
      'BETTER_AUTH_SECRET="12345678901234567890123456789012"',
    )
    expect(writeFileMock.mock.calls[0][1]).toContain('BETTER_AUTH_URL="http://localhost:3000"')
    expect(writeFileMock.mock.calls[0][1]).toContain(`WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalizedProjectRoot)}`)
    expect(writeFileMock.mock.calls[0][1]).toContain(`WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue(normalizedProjectRoot)}`)
    expect(writeFileMock.mock.calls[0][1]).toContain('LOCAL_SETUP_ENABLED="true"')
    expect(writeFileMock.mock.calls[0][1]).toContain('GROQ_API_KEY="groq-key-value"')
  })

  it("preserves unrelated .env.local keys while updating managed keys", async () => {
    readFileMock.mockResolvedValue(
      [
        "CUSTOM_FLAG=true",
        'BETTER_AUTH_URL="http://localhost:1111"',
        'DATABASE_URL="postgres://old"',
        'WILLIAMOS_PROJECT_ROOT="C:/repos/william-os-devops"',
        'WILLIAMOS_TERRAFUSION_ROOT="/repos/old"',
        "",
      ].join("\n"),
    )
    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        terraFusionRoot: projectRoot,
      }),
    })

    const response = await POST(req)
    const body = await response.json()
    const writtenEnv = writeFileMock.mock.calls[0][1]

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(writtenEnv).toContain("CUSTOM_FLAG=true")
    expect(writtenEnv).toContain(
      'DATABASE_URL="postgres://postgres:postgres@localhost:5432/terragroq"',
    )
    expect(writtenEnv).toContain('BETTER_AUTH_SECRET="12345678901234567890123456789012"')
    expect(writtenEnv).toContain('BETTER_AUTH_URL="http://localhost:3000"')
    expect(writtenEnv).toContain('LOCAL_SETUP_ENABLED="true"')
    expect(writtenEnv).toContain('WILLIAMOS_PROJECT_ROOT="C:/repos/william-os-devops"')
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalizedProjectRoot)}`)
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue(normalizeProjectRootForEnv(path.resolve("/repos/old")))}`)
    expect(writtenEnv).not.toContain('WILLIAMOS_TERRAFUSION_ROOT="/repos/old"')
    expect(writtenEnv).not.toContain('DATABASE_URL="postgres://old"')
  })

  it("lets an auth-ready closed instance add only its TerraFusion checkout", async () => {
    process.env.AUTH_SIGNUP_MODE = "closed"
    readFileMock.mockResolvedValue(
      [
        'DATABASE_URL="postgres://existing"',
        'BETTER_AUTH_SECRET="existing-auth-secret-must-not-change"',
        'WILLIAMOS_PROJECT_ROOT="C:/repos/william-os-devops"',
        'WILLIAMOS_TERRAFUSION_ROOT="C:/repos/old-terrafusion"',
        "CUSTOM_FLAG=true",
        "",
      ].join("\n"),
    )

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "terrafusion-root",
        terraFusionRoot: projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()
    const writtenEnv = writeFileMock.mock.calls[0][1] as string

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, restartRequired: true })
    expect(getAuthReadinessMock).toHaveBeenCalledWith({ probeDatabase: true })
    expect(writtenEnv).toContain('DATABASE_URL="postgres://existing"')
    expect(writtenEnv).toContain('BETTER_AUTH_SECRET="existing-auth-secret-must-not-change"')
    expect(writtenEnv).toContain('WILLIAMOS_PROJECT_ROOT="C:/repos/william-os-devops"')
    expect(writtenEnv).toContain("CUSTOM_FLAG=true")
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalizedProjectRoot)}`)
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue("C:/repos/old-terrafusion")}`)
    expect(writtenEnv).not.toContain('WILLIAMOS_TERRAFUSION_ROOT="C:/repos/old-terrafusion"')
  })

  it("preserves the original Space identity across repeated checkout moves", async () => {
    process.env.AUTH_SIGNUP_MODE = "closed"
    readFileMock.mockResolvedValue(
      [
        'DATABASE_URL="postgres://existing"',
        'BETTER_AUTH_SECRET="existing-auth-secret-must-not-change"',
        'WILLIAMOS_TERRAFUSION_ROOT="C:/repos/second-terrafusion"',
        'WILLIAMOS_TERRAFUSION_SPACE_IDENTITY="C:/repos/original-terrafusion"',
        "",
      ].join("\n"),
    )

    const response = await POST(new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "terrafusion-root", terraFusionRoot: projectRoot }),
    }))
    const writtenEnv = writeFileMock.mock.calls[0][1] as string

    expect(response.status).toBe(200)
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_ROOT=${serializeProjectRootEnvValue(normalizedProjectRoot)}`)
    expect(writtenEnv).toContain(`WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue("C:/repos/original-terrafusion")}`)
    expect(writtenEnv).not.toContain(`WILLIAMOS_TERRAFUSION_SPACE_IDENTITY=${serializeProjectRootEnvValue("C:/repos/second-terrafusion")}`)
  })

  it("refuses root-only setup until WilliamOS authentication is actually ready", async () => {
    process.env.AUTH_SIGNUP_MODE = "closed"
    getAuthReadinessMock.mockResolvedValueOnce({ ready: false })

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "terrafusion-root",
        terraFusionRoot: projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.message).toContain("authentication-ready")
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it("surfaces write failures as 500 responses", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"))

    const req = new Request("http://localhost:3000/api/setup/local-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        databaseUrl: "postgres://postgres:postgres@localhost:5432/terragroq",
        authSecret: "12345678901234567890123456789012",
        authUrl: "http://localhost:3000",
        terraFusionRoot: projectRoot,
      }),
    })
    const response = await POST(req)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.message).toContain("Failed to write .env.local")
    expect(body.message).toContain("disk full")
  })
})
