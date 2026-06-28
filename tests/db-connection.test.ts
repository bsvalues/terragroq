import { describe, expect, it } from "vitest"
import { buildPoolConfig, normalizeDatabaseUrlForPg } from "@/lib/db/connection"

describe("database connection SSL normalization", () => {
  it("upgrades sslmode=require to verify-full for pg compatibility", () => {
    const normalized = normalizeDatabaseUrlForPg(
      "postgres://user:pass@example.neon.tech/db?sslmode=require",
    )

    expect(normalized).toBe(
      "postgres://user:pass@example.neon.tech/db?sslmode=verify-full",
    )
  })

  it("upgrades other ambiguous ssl modes that pg currently aliases", () => {
    expect(
      normalizeDatabaseUrlForPg("postgres://user:pass@example.neon.tech/db?sslmode=prefer"),
    ).toContain("sslmode=verify-full")
    expect(
      normalizeDatabaseUrlForPg("postgres://user:pass@example.neon.tech/db?sslmode=verify-ca"),
    ).toContain("sslmode=verify-full")
  })

  it("preserves already explicit verify-full URLs", () => {
    const url = "postgres://user:pass@example.neon.tech/db?sslmode=verify-full"

    expect(normalizeDatabaseUrlForPg(url)).toBe(url)
  })

  it("preserves URLs without sslmode and non-Postgres values", () => {
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@example.neon.tech/db")).toBe(
      "postgres://user:pass@example.neon.tech/db",
    )
    expect(normalizeDatabaseUrlForPg("not-a-url")).toBe("not-a-url")
  })

  it("normalizes postgresql protocol URLs", () => {
    expect(
      normalizeDatabaseUrlForPg(
        "postgresql://user:pass@example.neon.tech/db?sslmode=require",
      ),
    ).toBe("postgresql://user:pass@example.neon.tech/db?sslmode=verify-full")
  })

  it("preserves unrelated query params while normalizing sslmode", () => {
    expect(
      normalizeDatabaseUrlForPg(
        "postgres://user:pass@example.neon.tech/db?application_name=terragroq&sslmode=require",
      ),
    ).toBe(
      "postgres://user:pass@example.neon.tech/db?application_name=terragroq&sslmode=verify-full",
    )
  })

  it("builds the pg pool config from the normalized database URL", () => {
    expect(
      buildPoolConfig("postgres://user:pass@example.neon.tech/db?sslmode=require"),
    ).toEqual({
      connectionString: "postgres://user:pass@example.neon.tech/db?sslmode=verify-full",
    })
  })

  it("omits connectionString when the database URL is unset or blank", () => {
    expect(buildPoolConfig(undefined)).toEqual({})
    expect(buildPoolConfig("")).toEqual({})
    expect(buildPoolConfig("   ")).toEqual({})
  })
})
