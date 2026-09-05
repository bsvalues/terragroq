import { describe, expect, it } from "vitest"

import {
  getDeploymentStatus,
  resolveDeploymentProfileName,
  resolveInferenceBaseUrl,
} from "@/lib/deployment/profile"

function countyEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    WILLIAMOS_DEPLOYMENT_PROFILE: "county-development",
    WILLIAMOS_DEPLOYMENT_ID: "benton-county-development",
    WILLIAMOS_OWNER_EMAIL: "owner@example.gov",
    BETTER_AUTH_URL: "http://127.0.0.1:3200",
    DATABASE_URL: "postgresql://user:secret@127.0.0.1:15434/williamos?sslmode=disable",
    WILLIAMOS_AI_BASE_URL: "http://127.0.0.1:11434/v1",
    WILLIAMOS_AI_MODEL: "qwen2.5-coder:1.5b",
    WILLIAMOS_EMBEDDING_MODEL: "snowflake-arctic-embed2",
    ...overrides,
  }
}

describe("WilliamOS County Development profile", () => {
  it("preserves the existing HERMES profile when no new profile is declared", () => {
    expect(resolveDeploymentProfileName({})).toBe("hermes-anchor")
    const status = getDeploymentStatus({})
    expect(status.profile).toBe("hermes-anchor")
    expect(status.valid).toBe(true)
    expect(status.localOnlyInference).toBe(false)
  })

  it("accepts an explicitly local County compartment", () => {
    const status = getDeploymentStatus(countyEnv())
    expect(status).toMatchObject({
      profile: "county-development",
      deploymentId: "benton-county-development",
      label: "COUNTY DEVELOPMENT",
      countyControlled: true,
      localOnlyInference: true,
      serviceOrigin: "http://127.0.0.1:3200",
      valid: true,
      violations: [],
    })
  })

  it("rejects remote service, database, inference, preview, and provider secrets", () => {
    const status = getDeploymentStatus(countyEnv({
      BETTER_AUTH_URL: "https://personal-hermes.example",
      DATABASE_URL: "postgresql://user:secret@atlas.example/williamos",
      WILLIAMOS_AI_BASE_URL: "https://api.openai.com/v1",
      WILLIAMOS_WORKSPACE_APP_URL: "https://preview.example",
      OPENAI_API_KEY: "present-but-never-returned",
    }))

    expect(status.valid).toBe(false)
    expect(status.violations).toEqual(expect.arrayContaining([
      "COUNTY_DEVELOPMENT_SERVICE_ORIGIN_MUST_BE_LOOPBACK",
      "COUNTY_DEVELOPMENT_DATABASE_MUST_BE_LOOPBACK",
      "COUNTY_DEVELOPMENT_INFERENCE_MUST_BE_LOOPBACK",
      "COUNTY_DEVELOPMENT_PREVIEW_MUST_BE_LOOPBACK",
      "COUNTY_DEVELOPMENT_REMOTE_PROVIDER_SECRET_FORBIDDEN:OPENAI_API_KEY",
    ]))
    expect(JSON.stringify(status)).not.toContain("present-but-never-returned")
  })

  it("refuses a remote AI endpoint before runtime construction", () => {
    expect(() => resolveInferenceBaseUrl(
      "https://api.example/v1",
      countyEnv(),
    )).toThrow("COUNTY_DEVELOPMENT_REMOTE_INFERENCE_FORBIDDEN")
    expect(resolveInferenceBaseUrl(undefined, countyEnv()))
      .toBe("http://127.0.0.1:11434/v1")
  })

  it("rejects unknown deployment profile names", () => {
    expect(() => resolveDeploymentProfileName({
      WILLIAMOS_DEPLOYMENT_PROFILE: "county-but-remote",
    })).toThrow("WILLIAMOS_DEPLOYMENT_PROFILE_INVALID")
  })
})
